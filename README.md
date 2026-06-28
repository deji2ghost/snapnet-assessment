## Getting Started

### Prerequisites
- Node.js 18+
- Docker Desktop (running)

---

### 1. Clone and install dependencies

```bash
npm install
```

---

### 2. Start the database

```bash
docker compose up -d
```

This starts PostgreSQL 16 on port 5432 with:
- User: `postgres`
- Password: `postgres`  
- Database: `peopleflow`

Wait a few seconds for the healthcheck to pass before the next step.

---

### 3. Generate the Prisma client

```bash
npx prisma generate
```

---

### 4. Run database migrations

```bash
npx prisma migrate deploy
```

This creates all tables (`employees`, `leave_requests`) in your PostgreSQL
database.

---

### 5. Seed test data

```bash
npx prisma db seed
```
### 6. Run tests

```bash
npm test
```

---

### 7. Start the development server

```bash
npm run start:dev
```

API is available at: `http://localhost:3000`

---

### Environment

The `.env` file is included at the project root and pre-configured to match
the Docker setup above. No changes needed:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/peopleflow"
```
### 6. Run tests

```bash
npm test
```

---

### 7. Start the development server

```bash
npm run start:dev
```

API is available at: `http://localhost:3000`

---

Copy the example env file:
```bash
cp .env.example .env
```

1. Who can approve leave?
   Any caller who provides a valid X-Approver-Id header can approve or reject a leave request. There is no role enforcement in this implementation, The approverId value is stored on the leave request in a column so you can see who approved it.

2. Are approvers required to be managers?
   Not enforced in this implementation. The database schema stores a role column on the Employee model, and the seed data creates one MANAGER

3. Are half-days supported or only full days?
    Only full days are supported in the current implementation. The countDays helper in returns a whole numberFor now, a request from Monday to Friday counts as 5 days.

4. Do weekends and public holidays count against leave balance?
  Yes, all calendar days are counted, including weekends.

5. How are dates stored and compared?
    Dates are stored as DATE in columns. All comparisons happen in the database via Prisma queries. UTC midnight is used consistently so the check behaves the same regardless of the server's local timezone. The overlap check uses Prisma lte and gte operators which generate a SQL range comparison existing. This correctly detects all partial and full overlaps.

6. What happens if two overlapping requests are submitted at nearly the same time?
    Only one will succeed. The other will receive a 409 Conflict. This is handled by wrapping the submit flow in a Prisma $transaction. Inside the transaction, we first lock the employee row with a query, then check for overlaps, then insert. Because both operations happen atomically inside the transaction, a concurrent second request queues behind the first. By the time it runs its overlap check, the first request's row already exists and the check finds a conflict.

7. How would you extend this for a multi-step approval chain?
    The current model supports a single approver. To support a line of approval the design would change, example like the table putting a rule where all role has to approve.

8. How would you enforce tenant isolation in production?
    Extract tenantId from a JWT, not a header.** After a user logs in, the JWT payload contains their tenantId. A NestJS AuthGuard verifies the JWT on every request and attaches req.user.tenantId to the request object.
  