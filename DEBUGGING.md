
1. What went wrong
    The status check and the balance deduction are two separate database operations with no lock between them. When the UI retried, both requests ran concurrently and both passed the status check before either had written APPROVED back to the database.

2. Why was the balance deducted twice?
    Assume the employee has an annual leave balance of 10 days and submits a 5-day annual leave request.
Request A starts: Reads the leave request PENDING, Reads the employee balance 10.
Before Request A finishes, Request B also starts: Reads the same leave request PENDING, Reads the same employee balance. Because both requests believe the leave is still pending, both proceed to deduct the same balance request A reads. The employee's balance becomes 0.

3. Proposed fix
    The approval process should execute inside a single database transaction so that all related operations succeed or fail together.

The implementation should also:

1 Perform the balance deduction using an atomic database update.
2 Only approve a request if its current status is still PENDING.
3 Roll back the transaction if any step fails.

4. Why this fix works

    Using a database transaction ensures that the approval is treated as one atomic operation instead of several independent operations. The status transition guard prevents another request from approving a leave request that has already been approved.


5. Preventing this issue in the future

To reduce the likelihood of similar problems in production, I would add the following:

* Database transaction so all approval steps execute together.
* Atomic balance update (or row-level locking) to prevent concurrent updates from modifying the same employee record incorrectly.
* **Status transition guard** so only requests with a `PENDING` status can be approved.
* **Idempotency key** so repeated approval requests caused by retries are processed only once.
* **Outbox or unique event record** so the `leave.approved` event is published only once, even if the handler is retried.
* **Concurrent approval tests** that send multiple approval requests simultaneously and verify that:

  * only one request succeeds,
  * the leave balance is deducted once,
  * only one approval event is published.
