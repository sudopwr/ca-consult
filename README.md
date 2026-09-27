# CA Consult

Appointment booking and income-tax-return filing for a Chartered Accountant practice.
A public site for clients, an admin panel for the practitioner.

- **Consultations** are by video call and **confirmed instantly** — no approval step.
- **ITR filings** are registered and then worked through a review → filing pipeline.
- **Messaging** is for clients with a live engagement; visitors get a captcha-protected
  contact form.

Node · Fastify · React · MUI · Supabase Postgres · clean architecture · TDD.

---

## Quick start

```bash
corepack enable                        # pnpm 10, pinned in package.json
pnpm install

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

supabase start                         # Postgres :54322 · Studio :54323 · Inbucket :54324
supabase status                        # copy the anon key into apps/web/.env

pnpm dev                               # API :3001 · web :5173
```

Open <http://localhost:5173>. The seed creates a published practice profile, six
services, weekly opening hours, and two accounts:

| | Email | Role |
|---|---|---|
| Practitioner | `admin@ca-consult.test` | ADMIN |
| Client | `client@ca-consult.test` | USER |

Both use `password123` locally. Production uses Google sign-in only — there is no
password path and no endpoint that can grant admin to yourself, so `supabase/seed.sql`
is the sole bootstrap.

To enable Google locally, set `GOOGLE_CLIENT_ID` / `GOOGLE_SECRET` and flip
`[auth.external.google] enabled = true` in `supabase/config.toml`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API and web, watching |
| `pnpm lint` | ESLint **including the architecture boundary rule** |
| `pnpm typecheck` | `tsc --noEmit` across every workspace |
| `pnpm test:unit` | Vitest — domain, use cases, React components |
| `pnpm test:e2e` | Playwright — starts both servers itself |
| `./scripts/verify-schema.sh` | 36 constraint tests against real Postgres |
| `./scripts/verify-concurrency.sh` | Two transactions racing for one slot |
| `pnpm build` | Builds contracts, API and web |
| `pnpm verify` | lint → typecheck → unit → build. Run before pushing. |

---

## Layout

```
packages/contracts/   zod schemas shared by API and web — one definition, no drift
apps/api/             Fastify.  domain → application → infrastructure → interface
apps/web/             Vite + React + MUI.  public site and admin panel
supabase/             config, 8 migrations, seed
e2e/                  Playwright
scripts/              database constraint tests
docs/architecture.md  the full design, data model and API contract
```

### The dependency rule

```
domain          imports nothing
application     imports domain
infrastructure  imports domain, application
interface       imports domain, application
```

`infrastructure` and `interface` never import each other. `composition-root.ts` is the
single exemption — the only file that knows about every layer, and the only place
anything is wired together.

Enforced by `eslint-plugin-boundaries` in `eslint.config.js`, and `pnpm lint` runs in
CI. Import `SystemClock` into a use case and the build goes red. An architecture that
only exists in a document decays within a month.

---

## Four decisions worth knowing before you read the code

**Bookings auto-confirm.** There is no `PENDING` state, which shapes everything: every
guard runs at booking time because nobody reviews it afterwards, and the confirmation
email leaves within seconds — so the meeting link has to be resolved and snapshotted
before the transaction commits. `ca_profile.default_meeting_url` holds the practice's
permanent room, and the database refuses to publish a landing page without one.

**Slots are derived, never stored.** `domain/scheduling/slot-generator.ts` computes
them from availability rules minus exceptions minus confirmed bookings. Pre-generating
rows would mean every schedule edit reconciles thousands of future records. It is a
pure function taking `now` as a parameter, which is why 35 tests covering DST,
buffers, partial blocks and boundary conditions run in milliseconds.

**The double-booking race is closed by Postgres, not by code.**

```sql
constraint no_overlapping_active_appointments
  exclude using gist (slot with &&) where (status = 'CONFIRMED')
```

Two clients clicking the same 11:00 slot in the same millisecond is not something an
application-level `SELECT`-then-`INSERT` can prevent. The second insert raises
`23P01`, the repository turns it into a `SlotNoLongerAvailable` domain error, and the
UI refetches. `./scripts/verify-concurrency.sh` proves it with two real transactions.

**The API talks to Postgres directly, not through `supabase-js`.** Booking writes an
appointment, its status history and three outbox rows — either all of it happens or
none of it does, and a REST client with no transaction API cannot express that.
Supabase remains exactly what it is: the hosted database and the auth provider.

---

## Testing

| Level | Runner | What it proves |
|---|---|---|
| Unit | Vitest | Domain rules and use cases, no I/O, fake clock |
| Component | Vitest + RTL | Forms, guards, loading and error states |
| Schema | psql | What the database itself refuses |
| E2E | Playwright | Real browser → real HTTP → real CORS → built bundles |

Coverage gates: **domain ≥ 95%**, application ≥ 90%. `infrastructure/` is deliberately
ungated — integration tests cover it, and chasing a number there produces mock theatre.

Fakes are real implementations of the ports backed by `Map`s, not mocking-library
stubs. `InMemoryAppointmentRepository` enforces the same overlap rule the database
does, so a use-case test and a production insert fail for the same reason rather than
by coincidence.

Real Google OAuth cannot be scripted, so `e2e/fixtures/auth.ts` mints a session
against the local Supabase JWT secret. Everything downstream — token verification, the
guards, the role lookup — runs for real.

---

## Conventions

- **Money is `bigint` paise.** ₹1,499.00 is `149900`. Never a float, never `numeric` in JS.
- **Errors are `application/problem+json`.** Clients branch on `problem.code`, never on
  a message string. The code-to-status table in
  `interface/http/plugins/error-handler.ts` is the only place the domain meets HTTP.
- **Nothing in `domain/` or `application/` calls `new Date()`.** Time arrives through
  the `Clock` port. That is what makes "cancel 11 h 59 m before the appointment" a
  one-line assertion.
- **PAN is never collected on the public form.** It is admin-writable only, via
  `PATCH /admin/itr-engagements/:id`, masked everywhere except the admin's engagement
  view, and redacted before it reaches the audit log.
- **`VITE_` variables are public.** Anything with that prefix ships to the browser; CI
  greps the built bundle for the service-role key.
- **Config is parsed once at boot and the process exits if it is wrong.** A missing key
  should kill the process at second zero, not surface as a 500 at 2 a.m.

---

## Notifications

Every notifying change writes a `notification_outbox` row **inside the same transaction
as the business change**. A worker delivers it afterwards with `FOR UPDATE SKIP
LOCKED`, retries with quadratic backoff, and gives up into `DEAD` rather than looping.
Forty lines that remove both failure modes of sending inline.

Reminders are future-dated outbox rows written at booking time — no cron job scanning
for appointments, and no missed reminders if the scheduler was down for an afternoon.

**SMS is built but dark.** `Msg91SmsSender` and the four SMS templates exist and are
tested; `NOTIFY_SMS_ENABLED=false` wires `NoopSmsSender` instead. Transactional SMS to
Indian numbers needs TRAI **DLT registration** — a registered entity, an approved
sender header, and a pre-approved template per message type. The bodies are written as
fixed strings with variable slots so that what gets registered is exactly what gets
sent. Turning SMS on is one environment variable and no code change.

---

## Deployment notes

- `DATABASE_URL` should use Supabase's **session pooler** (port 5432), not the
  transaction pooler — the unit of work holds a connection across several statements.
- The API is stateless apart from the in-process workers. `FOR UPDATE SKIP LOCKED`
  means running them on every instance is safe.
- Set `WEB_ORIGIN` to the deployed front end, or CORS will reject every request.
- RLS is enabled with **no policies** on every table. The API holds the service-role
  key and enforces authorisation in its use cases; RLS exists so that a leaked anon key
  reads nothing at all.
