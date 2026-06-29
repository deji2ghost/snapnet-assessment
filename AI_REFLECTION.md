## 1. Which AI tools did you use?

Claude (Anthropic) was used throughout this assessment.

## 2. How did you use it?
- To draft the Prisma schema and talk through whether `@db.Date` was the
  right field type for leave dates versus `DateTime`.
- To help structure the DEBUGGING.md and DESIGN_NOTES.md answers after I had
  reasoned through the problems myself.
- To review my service logic for the concurrency fix and confirm the approach
  was correct before I committed to it.
- To generate the initial test file, which I then corrected for import paths
  and mock behaviour that did not match my actual service.

## 3. Which generated code did I modify and why?

**The approval service method.** The first draft Claude produced used a
read-then-update pattern — it read the leave request, checked the status, then
updated it in a second query. I recognised this was the same race condition
described in Section 2 and rewrote it to use `updateMany` with
`WHERE status = 'PENDING'` as a single atomic operation, with the balance
deduction inside the same `$transaction`. That change was entirely my
reasoning.

**The Prisma schema.** Claude suggested a standard `prisma-client-js`
generator config. My project uses `prisma-client` with a custom `output` path
and `moduleFormat = "cjs"` because of how the NestJS CLI sets up the build.
I kept my existing generator config and did not use the suggested one.

**The seed script.** Claude used `upsert` with `where: { id }` but my schema
defines the unique constraint on `[tenantId, email]`, not on `id` alone for
upserts. I corrected the `where` clause to match the actual unique index.

## 4. What AI suggestions did I reject and why?

**Using TypeORM instead of Prisma.** The first suggestion was to use TypeORM
since it is the more common NestJS default. I rejected this because I am more
fluent in Prisma.

**A separate `AuditService`.** Claude suggested extracting audit logging into
its own injectable service for separation of concerns. I rejected this for
now — the assessment explicitly says not to overbuild, and adding a service
boundary for a single INSERT call adds indirection without value at this
scope. I documented what the audit log design would look like in
DESIGN_NOTES.md instead.

**Redis for idempotency keys.** Suggested as a way to deduplicate approval
requests. Correct for production, but introduces an infrastructure dependency
(Redis) for a problem already solved by the atomic `updateMany` pattern. I
documented it in DEBUGGING.md as a future measure rather than implementing it.

**Returning the updated record from `updateMany`.** Claude suggested using
`update` instead of `updateMany` to get the updated row back directly.
`update` in Prisma throws if the WHERE clause matches nothing rather than
returning a count, which makes it harder to distinguish "not found" from
"wrong status" in the error handler. I kept `updateMany` + a follow-up
`findUniqueOrThrow` because the intent is clearer and the error handling is
more explicit.

## 5. What technical decisions were entirely mine?

- Choosing Prisma over TypeORM because I can defend it confidently.
- The atomic `updateMany WHERE status = 'PENDING'` pattern for both approve
  and reject — recognising that this was the direct fix for the Section 2 bug
  and applying it consistently.
- Using `$transaction` for both submit and approve, and understanding why
  it matters for each case differently: submit needs it for the overlap check
  plus insert, approve needs it to tie the status transition and balance
  deduction together so neither can succeed without the other.
- Counting all calendar days including weekends, and documenting the reason
  rather than silently picking a behaviour.
- Keeping `tenantId` in every single query and writing the README section
  explaining exactly how that would be strengthened in production with JWTs.

## 6. What part of the work would I be most comfortable defending?

The concurrency handling in the approval endpoint.

I can explain the original bug, why the naive fix of wrapping
in a transaction alone is not enough without an atomic WHERE guard, and
exactly how `updateMany WHERE status = 'PENDING'` forces PostgreSQL to
serialise the two concurrent writes at the row level so only one can ever
succeed.

I can also explain why the balance deduction must be inside the same transaction as the status update — if they were separate, a crash between the two would leave the status as APPROVED with no deduction, or deducted with no approval, and there would be no safe way to recover. This is the section of the code I reasoned through myself, modified from what was generated, and can walk through line by line.