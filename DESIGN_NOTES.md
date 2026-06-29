## Section 3: System Design Questions

### 1. Scaling Leave Submissions

**If the spike overwhelms the write path:**
Route submissions through a job queue (BullMQ or SQS). The API enqueues the
request and returns `202 Accepted` with a job ID. Workers process submissions
sequentially per employee, which eliminates the need for `FOR UPDATE` row
locks and increases write throughput significantly.

**What to measure first:**

- p95 and p99 response latency on POST /leave-requests
- Postgres connection wait time and lock contention metrics
- Queue depth and worker lag during the 4pm window
- Error rate on the overlap-check query under concurrent load

### 2. Duplicate Event Processing

Use the idempotent consumer pattern. Each event carries a stable ID.

### 3. Audit Logging

Write audit records inside the same database transaction as the approve/reject operation itself, Because it's in the same transaction, the audit record is atomic with the status change.

### 4. Sync vs Async Balance Deduction

Synchronous

- Balance is accurate immediately
- Slightly slower approve endpoint
- Simple, one transaction

Asynchronous (worker)

- Balance can be stale until worker runs
- Employee may submit a second request against a stale balance
- Needs a worker, retry logic, dead-letter queue

**My choice: synchronous.**
Leave balance is a financial record.. The synchronous path adds only one extra UPDATE to an existing transaction, the latency cost is minimal and the correctness guarantee is what we need.

### 5. Monolith vs Microservice

Keep it in the monolith now. Leave management is tightly coupled to employee data (balance lookup). approval workflow. Extracting it early forces every balance check and status update across a network boundary, turning a single transaction into a distributed saga.

**Extract when:**

- The leave team is large enough that shared deployments are blocking separate
  release cycles, OR
- Leave submission throughput is measurably bottlenecking the rest of the
  system, OR

**What breaks if you split too early:**

- Cross-service joins between employees and leave_requests become HTTP
  calls. Latency compounds.
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
- If payroll has already consumed the leave.approved event, flipping the
  status to PENDING in the UI does nothing to undo downstream effects.
- It sets a precedent for bypassing business rules under deadline pressure,
  which becomes harder to walk back.

**What I would recommend:**
The 2 week estimate covers notification rollback, approval re-entry chains, and payroll integration, none of which exist yet. The minimal correct implementation is about 2 hours of work: a new CANCELLED terminal status, a single endpoint that transitions APPROVED to CANCELLED, restores the balance atomically in the same transaction, and writes one audit row. That is shippable before Friday and is also correct.

**What I would ship for the demo:**
`POST /leave-requests/:id/cancel` — transitions APPROVED to CANCELLED, restores annual leave balance writes to the audit log. Works for the demo and stays correct in production.

**What I would refuse to ship:**
Flipping status to PENDING without balance restoration or an audit record. A demo bug discovered by the prospective client is worse than a demo delay.

### Scenario B: Consistency vs Performance

**Tradeoffs:**

Direct DB query - Always correct - Slow page loads
Redis cache - Application read stale data, Can be wrong for up to 60 seconds

**My recommendation: direct DB query, but optimised first.**
For an HR product adjacent to payroll, showing a stale balance is a trust problem. An employee sees 5 days available, submits a 5-day request, and gets rejected because the real balance is 0 — that is a bad experience that erodes confidence in the product. The 80ms is the current unoptimised baseline. Before introducing a cache I would:

1. Add a covering index on (id, annual_leave_balance) so the balance query
   is index-only — no heap access needed.
2. Serve the balance query from a read replica to avoid competing with write
   traffic.

These changes typically bring the query to 5 to 15ms without any staleness risk.

**If caching is still required after optimisation:**
Use a write-through cache — update Redis at the same time as Postgres, inside
the approval transaction. This keeps the cache always current without relying
on a TTL window. The only downside is that a Redis failure during approval
needs a fallback (skip the cache write and let the next read repopulate it).

### Scenario C: Conflicting Requirements — Retention vs Privacy

**The tension:**
Legal requires sick leave records for 7 years. Engineering must hard delete employee PII on account deletion. Both are described as non-negotiable, but they are not actually in conflict they are operating on different things. Legal needs the record of the leave event. Engineering needs to remove personally identifiable information These can be satisfied simultaneously by separating the two.

**How to reconcile them: anonymise, don't delete the record**

When an employee account is deleted, do not delete their leave records.
Instead, scrub the PII from the record and replace it with a reference to a
tombstone entry. The event (sick leave was taken, for N days, on these dates)
is retained for legal compliance. The person it belongs to is no longer
identifiable.

**High-level data model changes**

```sql

CREATE TABLE deleted_employee_tombstones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  deleted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retention_until TIMESTAMPTZ NOT NULL 
);
```

When an employee account is deleted, run this in a single transaction:

Create a tombstone row → get tombstone.id
UPDATE leave_requests

SET employee_id      = tombstone.id,

approved_by_id   = NULL,

rejected_by_id   = NULL

WHERE employee_id = deleted_employee.id

AND leave_type  = 'SICK'     

AND created_at  >= NOW() - INTERVAL '7 years'
DELETE leave_requests

WHERE employee_id = deleted_employee.id

AND (leave_type != 'SICK'

OR created_at < NOW() - INTERVAL '7 years')
DELETE FROM employees WHERE id = deleted_employee.id


After this transaction:
- The employee row is gone no name, email, or PII remains.
- SICK leave records within the 7 year window still exist, but point to an
  anonymous tombstone with no identifying information.
- ANNUAL and UNPAID leave outside the retention window is deleted entirely.

**Retention cleanup**

A scheduled background job runs nightly:

```sql
DELETE FROM leave_requests lr
USING deleted_employee_tombstones t
WHERE lr.employee_id = t.id
  AND t.retention_until < NOW();

DELETE FROM deleted_employee_tombstones
WHERE retention_until < NOW();
```

Once the 7-year window expires, even the anonymised records are purged.

