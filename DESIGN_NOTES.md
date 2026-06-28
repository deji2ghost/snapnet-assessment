# DESIGN_NOTES.md — Sections 3 & 4

---

## Section 3: System Design Questions

### 1. Scaling Leave Submissions

**Immediate wins (no architecture change):**
Add a read replica so the overlap-check SELECT does not compete with approval
writes on the primary. Put PgBouncer in front of Postgres to prevent
connection exhaustion during the Friday spike — each Node.js process holds
open connections that add up fast across 500 tenants.

**If the spike still overwhelms the write path:**
Route submissions through a job queue (BullMQ or SQS). The API enqueues the
request and returns `202 Accepted` with a job ID. Workers process submissions
sequentially per employee, which eliminates the need for `FOR UPDATE` row
locks and increases write throughput significantly.

**What to measure first:**
- p95 and p99 response latency on `/leave-requests POST`
- Postgres connection wait time and lock contention metrics
- Queue depth and worker lag during the 4pm window
- Error rate on the overlap-check query under concurrent load

---

### 2. Duplicate Event Processing

Use the **idempotent consumer** pattern. Each event carries a stable ID such
as `leave.approved:{requestId}`. Consuming services (payroll, notifications)
maintain a `processed_events` table:

```sql
INSERT INTO processed_events (event_id, processed_at)
VALUES ($1, NOW())
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id;
```

If the INSERT returns no rows, the event was already processed — skip it.
Wrap the INSERT and the business operation in the same database transaction.
This gives exactly-once semantics at the application level regardless of how
many times the message broker delivers the event.

---

### 3. Audit Logging

Write audit records **inside the same database transaction** as the
approve/reject operation itself:

```sql
CREATE TABLE leave_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL,
  actor_id    UUID NOT NULL,
  action      VARCHAR(50) NOT NULL,   -- 'APPROVED', 'REJECTED'
  old_status  VARCHAR(50),
  new_status  VARCHAR(50),
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

Because it's in the same transaction, the audit record is atomic with the
status change — if the approval fails, the audit row is also rolled back.
For immutability, grant the application role only `INSERT` on this table,
never `UPDATE` or `DELETE`. This adds one extra INSERT per action, which is
negligible compared to the existing transaction overhead.

---

### 4. Sync vs Async Balance Deduction

| | Synchronous (our implementation) | Asynchronous (worker) |
|---|---|---|
| Consistency | Balance is accurate immediately | Balance can be stale until worker runs |
| Risk | Slightly slower approve endpoint | Employee may submit a second request against a stale balance |
| Complexity | Simple, one transaction | Needs a worker, retry logic, dead-letter queue |

**My choice: synchronous.**

Leave balance is a financial record adjacent to payroll. Eventual consistency
is acceptable for social media feeds; it is not acceptable when an employee
can see a balance that hasn't been decremented yet and submit a second leave
request on top of it. The synchronous path adds only one extra `UPDATE` to an
existing transaction — the latency cost is minimal and the correctness
guarantee is worth it.

---

### 5. Monolith vs Microservice

**Keep it in the monolith now.** Leave management is tightly coupled to
employee data (balance lookup), approval workflow (status transitions), and
potentially payroll. Extracting it early forces every balance check and status
update across a network boundary, turning a single transaction into a
distributed saga — with all the failure modes that come with it.

**Extract when:**
- The leave team is large enough that shared deployments are blocking separate
  release cycles, OR
- Leave submission throughput is measurably bottlenecking the rest of the
  system, OR
- Compliance requires a separately auditable and independently deployable
  service.

**What breaks if you split too early:**
- Cross-service joins between `employees` and `leave_requests` become HTTP
  calls. Latency compounds.
- The `$transaction` that atomically updates status and deducts balance
  disappears. You now need a saga pattern with compensation steps — far more
  complex to implement and test.
- Schema changes require coordinated deployments across both services.
- Debugging a failed approval now requires correlating logs across two
  services instead of one.

---

## Section 4: Product & Engineering Judgment

### Scenario A: The Quick Win — "Just flip the status back to PENDING"

**Risks of the PM's suggestion:**

- The employee's balance is not restored. They lose those days permanently
  until someone manually corrects the database.
- No audit trail means compliance cannot see that a cancellation happened or
  who authorised it.
- If payroll has already consumed the `leave.approved` event, flipping the
  status to PENDING in the UI does nothing to undo downstream effects.
- It sets a precedent for bypassing business rules under deadline pressure,
  which becomes harder to walk back.

**What I would recommend:**

The 2-week estimate covers notification rollback, approval re-entry chains,
and payroll integration — none of which exist yet. The minimal correct
implementation is about 2 hours of work: a new `CANCELLED` terminal status, a
single endpoint that transitions `APPROVED → CANCELLED`, restores the balance
atomically in the same transaction, and writes one audit row. That is
shippable before Friday and is also correct.

**What I would ship for the demo:**

`POST /leave-requests/:id/cancel` — transitions APPROVED to CANCELLED,
restores annual leave balance, writes to the audit log. Works for the demo
and stays correct in production.

**What I would refuse to ship:**

Flipping status to PENDING without balance restoration or an audit record.
A demo bug discovered by the prospective client is worse than a demo delay.
I would show the PM the 2-hour estimate and offer to pair on it that afternoon.

---

### Scenario B: Consistency vs Performance

**Tradeoffs:**

| | Direct DB query (80ms) | Redis cache (5ms, up to 60s stale) |
|---|---|---|
| Accuracy | Always correct | Can be wrong for up to 60 seconds |
| Risk | Slow page loads | Employee submits leave on stale balance |
| Complexity | Simple | Cache invalidation, Redis infra, eviction logic |

**My recommendation: direct DB query, but optimised first.**

For an HR product adjacent to payroll, showing a stale balance is a trust
problem. An employee sees 5 days available, submits a 5-day request, and gets
rejected because the real balance is 0 — that is a bad experience that
erodes confidence in the product. The 80ms is the current unoptimised
baseline. Before introducing a cache I would:

1. Add a covering index on `(id, annual_leave_balance)` so the balance query
   is index-only — no heap access needed.
2. Serve the balance query from a read replica to avoid competing with write
   traffic.

These changes typically bring the query to 5–15ms without any staleness risk.

**If caching is still required after optimisation:**
Use a write-through cache — update Redis at the same time as Postgres, inside
the approval transaction. This keeps the cache always current without relying
on a TTL window. The only downside is that a Redis failure during approval
needs a fallback (skip the cache write and let the next read repopulate it).