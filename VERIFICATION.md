# What was verified, and what was not

This project was built in a sandbox where the **npm registry is blocked by network
policy** (`registry.npmjs.org` → `403 host_not_allowed`). Dependencies could not be
installed, so Vitest, ESLint, the Vite build and Playwright could not run here.

Rather than hand over work with no evidence behind it, everything that does not need
the registry was executed for real. That turns out to be the two hardest parts: the
domain and application layers import nothing external by design, and the database's
guarantees only need Postgres.

## ✅ Verified by execution

### 260 unit tests, all passing

Run on Node's built-in test runner via `tsx`, using the real spec files.

| Suite | Tests | What it covers |
|---|---:|---|
| `slot-generator.spec.ts` | 35 | Grid walking, buffers, whole-day and partial blocks, EXTRA openings, effective dates, overlapping rules, lead-time and advance-window boundaries, existing bookings, off-grid rejection |
| `itr-and-messaging.spec.ts` | 32 | ITR registration and workflow, PAN handling, the messaging gate, contact-form spam defences |
| `value-objects.spec.ts` | 30 | Phone normalisation, PAN validation and masking, integer-paise money |
| `appointment.spec.ts` | 26 | The full transition table, exhaustively — every legal and illegal pair × every actor |
| `book-appointment.spec.ts` | 22 | Auto-confirm, snapshots, outbox writes, every guard, abuse brakes, idempotency |
| `appointment-lifecycle.spec.ts` | 22 | Cancel, reschedule, complete, no-show, lockout, meeting-link changes, audit |
| `itr-engagement.spec.ts` | 22 | The ITR transition table, exhaustively |
| `messaging-policy.spec.ts` | 17 | Who may open a thread, and why replying is deliberately not gated |
| `time.spec.ts` | 17 | Timezone conversion including a **DST spring-forward** case |
| `booking-policy.spec.ts` | 16 | Lead time, 12-hour cancellation window, per-user caps, no-show lockout |
| `outbox-worker.spec.ts` | 8 | Delivery, future-dated reminders, dedupe, backoff, the DEAD ceiling |
| `service-health.spec.ts` | 8 | Health aggregation, negative-uptime guard |
| `get-health.spec.ts` | 5 | Probe failures as degraded rather than a crash |

### 36 schema constraint tests, all passing

`./scripts/verify-schema.sh` against PostgreSQL 16, each check isolated in its own
rolled-back transaction. Covers the exclusion constraint, half-open adjacency,
re-booking after cancellation, the one-live-filing-per-year partial unique index, PAN
format, filed-needs-acknowledgement, the publishable-profile rule, idempotency keys,
outbox dedupe, and both reference triggers.

### The concurrency test

`./scripts/verify-concurrency.sh` — two real transactions racing for one slot. One
commits, one is rejected, exactly one row survives. This is the guarantee the whole
booking design rests on.

### 72 files typecheck with zero errors

Full strict mode (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `verbatimModuleSyntax`) across domain, application,
repositories, workers, serialisers, templates and the in-memory fakes.

### Two real bugs were found and fixed by this process

1. **`normaliseIndianPhone` invented country codes.** A Mumbai landline typed without
   a country code (`2266000000`) was being turned into `+2266000000` — a valid-looking
   E.164 number in some other country, which would have failed every SMS silently.
   Caught by a unit test; now rejected outright.
2. **`Querier.query<R>` was over-constrained.** `R extends Record<string, unknown>`
   rejected every named row interface, because a named interface has no index
   signature. Caught by the typecheck; relaxed to `R extends object`.

A third, smaller one: TypeScript narrowed an outbox array to its first element's
literal template key, rejecting the admin notice appended after it.

## ⚠️ Not verified — run these yourself

```bash
pnpm install && pnpm verify        # lint, typecheck, unit, build
pnpm test:e2e                      # needs `supabase start` first
```

| Not run | Why |
|---|---|
| ESLint, including the boundary rule | needs `eslint-plugin-boundaries` |
| The Vite production build | needs the React and MUI toolchain |
| React component tests | needs Vitest, RTL, jsdom |
| Playwright e2e (3 specs) | needs the browser harness and a running Supabase |
| Fastify route wiring | needs `fastify`, `@fastify/*`, `zod` |
| Postgres repositories against a live database | needs `pg` |
| `env.spec.ts` | needs `zod` |

The riskiest unverified area is the **SQL in the repositories**. The schema they target
is tested, and the queries are ordinary parameterised SQL, but no query has actually
executed. Expect the first `pnpm test:e2e` to surface a column-name typo or two; those
are cheap to fix and loud when they fail.

If anything does fail, paste the output and it can be fixed quickly.
