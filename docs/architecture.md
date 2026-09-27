# CA Appointment & Consultancy Platform — Architecture and Data Model

**Version** 0.2 — six scope decisions applied · **Date** 16 Sep 2026 · **Locale** India, `Asia/Kolkata`

> **Changes since v0.1** — bookings auto‑confirm; consultations are **video‑only**; **ITR filing is a first‑class registerable engagement**, not just a price list; messaging is gated on having an engagement, with a separate captcha‑protected contact form for visitors; cancellation window fixed at 12 h; **v1 ships email‑only**, SMS behind a feature flag pending DLT approval. Three of these have knock‑on design consequences — §5.3, §7, §10.

---

## 1. Decisions locked in

| Area | Decision |
|---|---|
| Backend | Node + **Fastify** REST API in front of Supabase. React never talks to the database directly. |
| Database | Supabase Postgres, accessed by the API with the **service role key**. RLS enabled and deny‑all as defence in depth. |
| Auth | **Supabase Auth** for everyone. End users sign in with Google; the admin is a seeded Supabase user. Fastify verifies the Supabase JWT offline via JWKS. |
| Roles | `role` lives in the app's own `user_profiles` table, not in the JWT. |
| Frontend | React 19 + TypeScript + Vite + MUI, built on `minimal-ui-kit/material-kit-react` (MIT). One app, two shells: public landing + `/admin`. |
| Architecture | Clean architecture — `domain ← application ← infrastructure/interface`, enforced by a lint rule. |
| Process | TDD, outside‑in. Vitest (unit + integration), Playwright (e2e). |
| **Booking** | **Auto‑confirmed.** A free slot booked is a confirmed appointment. No admin approval step. |
| **Mode** | **Video only.** No mode column, no in‑person/phone branching anywhere in v1. |
| **ITR filing** | A **registerable engagement** with its own workflow lifecycle — no time slot, admin‑reviewed. |
| **Messaging** | Only for users with a live engagement. Visitors get a **Turnstile‑protected contact form** instead. |
| **Cancellation** | User may self‑cancel up to **12 h** before start. |
| **Notifications** | **Email in v1.** SMS ports and templates built, adapter disabled behind `NOTIFY_SMS_ENABLED` until DLT clears. |

### Still out of v1
Online payments, document upload, multi‑CA support, invoicing, calendar sync, realtime chat. §13 says where each one slots in.

---

## 2. Domain language

| Term | Meaning |
|---|---|
| **CA Profile** | The single practitioner's public identity plus the **default meeting room URL** (see §5.3). |
| **Service** | A priced offering. `CONSULTANCY` (has a duration, booked into a slot) or `ITR_FILING` (has an assessment year, registered as an engagement). |
| **Availability Rule** | A recurring weekly window the CA is open, e.g. Mon–Fri 10:00–13:00, 30‑minute slots. |
| **Schedule Exception** | A one‑off override on a date: `BLOCKED` (holiday) or `EXTRA` (opening a Saturday). |
| **Slot** | A **derived** bookable interval. Never stored. |
| **Appointment** | A confirmed video consultation occupying one slot. |
| **ITR Engagement** | A registered ITR filing job. No slot; moves through a review → filing workflow. |
| **Engagement** | Umbrella term for "an appointment or an ITR engagement" — what the messaging gate checks for. |
| **Thread / Message** | A user↔admin conversation, available only to users with an engagement. |
| **Contact Enquiry** | A one‑way message from an anonymous visitor, captcha‑gated. Not a thread. |
| **Outbox entry** | A pending email (or SMS, later), written in the same transaction as the business change. |

**Slots are derived, not stored.** Pre‑generating slot rows means every schedule edit has to reconcile thousands of future rows; deriving them means a schedule edit is one `UPDATE` and a pure function does the rest. It also gives a perfect unit‑test target with zero I/O.

---

## 3. Repository layout

```
ca-consult/
├── package.json / pnpm-workspace.yaml / turbo.json
├── docker-compose.yml                 # api + web + supabase, for e2e
│
├── packages/contracts/                # zod schemas + inferred types, shared by api & web
│   └── src/{appointment,itr-engagement,service,availability,user,message,contact,ca-profile,errors}.ts
│
├── apps/api/
│   ├── src/
│   │   ├── domain/                              # NO imports from anywhere else
│   │   │   ├── appointment/
│   │   │   │   ├── appointment.ts               # entity + state machine
│   │   │   │   ├── appointment-status.ts
│   │   │   │   └── booking-policy.ts            # lead time, cancel window, per-user caps
│   │   │   ├── itr/
│   │   │   │   ├── itr-engagement.ts            # entity + its own state machine
│   │   │   │   └── itr-status.ts
│   │   │   ├── scheduling/
│   │   │   │   ├── availability-rule.ts
│   │   │   │   ├── schedule-exception.ts
│   │   │   │   ├── time-range.ts
│   │   │   │   └── slot-generator.ts            # ★ pure, the heart of the app
│   │   │   ├── messaging/
│   │   │   │   ├── thread.ts
│   │   │   │   └── messaging-policy.ts          # ★ who is allowed to open a thread
│   │   │   ├── user/{user-profile,phone-number,pan-number}.ts
│   │   │   ├── service/service.ts
│   │   │   └── shared/{money,result,domain-error}.ts
│   │   │
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   │   ├── {appointment,itr-engagement,availability,user,service,message,contact-enquiry,ca-profile}-repository.ts
│   │   │   │   ├── notification-outbox.ts
│   │   │   │   ├── captcha-verifier.ts          # ★ Turnstile behind a port
│   │   │   │   ├── unit-of-work.ts
│   │   │   │   ├── clock.ts
│   │   │   │   └── id-generator.ts
│   │   │   └── use-cases/
│   │   │       ├── list-available-slots.ts
│   │   │       ├── book-appointment.ts          # auto-confirms
│   │   │       ├── cancel-appointment.ts
│   │   │       ├── reschedule-appointment.ts
│   │   │       ├── mark-appointment-outcome.ts  # completed / no-show
│   │   │       ├── register-itr-engagement.ts
│   │   │       ├── advance-itr-engagement.ts
│   │   │       ├── complete-user-profile.ts
│   │   │       ├── set-user-status.ts
│   │   │       ├── upsert-ca-profile.ts
│   │   │       ├── manage-service.ts
│   │   │       ├── manage-availability.ts
│   │   │       ├── start-thread.ts              # enforces the messaging gate
│   │   │       ├── post-message.ts
│   │   │       ├── submit-contact-enquiry.ts    # verifies captcha
│   │   │       └── get-admin-dashboard.ts
│   │   │
│   │   ├── infrastructure/
│   │   │   ├── supabase/{client,*-repository,mappers/,pg-unit-of-work}.ts
│   │   │   ├── notifications/
│   │   │   │   ├── resend-email-sender.ts
│   │   │   │   ├── msg91-sms-sender.ts          # built, wired only when the flag is on
│   │   │   │   ├── noop-sms-sender.ts           # the v1 default
│   │   │   │   └── templates/
│   │   │   ├── captcha/turnstile-verifier.ts
│   │   │   └── {system-clock,uuid-generator}.ts
│   │   │
│   │   ├── interface/
│   │   │   ├── http/
│   │   │   │   ├── server.ts                    # buildServer(deps) → Fastify
│   │   │   │   ├── plugins/{auth,error-handler,rate-limit,request-context}.ts
│   │   │   │   ├── guards/
│   │   │   │   │   ├── require-auth.ts
│   │   │   │   │   ├── require-admin.ts
│   │   │   │   │   ├── require-complete-profile.ts
│   │   │   │   │   └── require-engagement.ts    # ★ the messaging gate
│   │   │   │   └── routes/{public,me,appointment,itr,message,contact}.routes.ts
│   │   │   │       └── admin/*.routes.ts
│   │   │   └── workers/
│   │   │       ├── outbox-worker.ts
│   │   │       └── reminder-scheduler.ts        # enqueues 24h reminders
│   │   │
│   │   ├── config/env.ts                        # zod-validated, fail fast
│   │   ├── composition-root.ts                  # the ONLY place wiring happens
│   │   └── main.ts
│   └── tests/{unit,integration,fakes}/
│
├── apps/web/src/
│   ├── app/{routes.tsx,providers.tsx,guards/}
│   ├── layouts/{public,dashboard}/
│   ├── features/
│   │   ├── landing/ booking/ itr-registration/ my-engagements/
│   │   ├── messaging/ onboarding/ contact/
│   │   └── admin/{dashboard,profile,services,schedule,users,appointments,itr,inbox,enquiries}/
│   └── shared/{api,auth,theme,ui}/
│
├── supabase/{config.toml,migrations/,seed.sql}
└── e2e/{fixtures,specs,playwright.config.ts}
```

### The dependency rule, enforced

```js
// .eslintrc — eslint-plugin-boundaries
rules: [
  { from: 'domain',         allow: ['domain'] },
  { from: 'application',    allow: ['domain', 'application'] },
  { from: 'infrastructure', allow: ['domain', 'application', 'infrastructure'] },
  { from: 'interface',      allow: ['domain', 'application', 'interface'] },
]
```

`infrastructure` and `interface` never import each other. `composition-root.ts` is the one exemption. If CI stays green, the architecture is real rather than aspirational.

---

## 4. Data model

### 4.1 Overview

```
auth.users ──1:1──→ user_profiles ──┬──< appointments ────────> services (CONSULTANCY)
                          │         │        └──< appointment_status_history
                          │         │
                          │         ├──< itr_engagements ─────> services (ITR_FILING)
                          │         │        └──< itr_status_history
                          │         │
                          │         └──< message_threads ──< messages
                          │                  ▲
                          │                  └── gated on ≥1 live engagement
                          ▼
                    (role: USER | ADMIN)

ca_profile (single row, holds default_meeting_url)
availability_rules ─┐
schedule_exceptions ├──→ slot generation (in memory)
appointments        ─┘

contact_enquiries    (anonymous, Turnstile-verified)
notification_outbox  (written in-transaction, drained by worker)
audit_log
```

### 4.2 Enums

```sql
create type user_role          as enum ('USER', 'ADMIN');
create type user_status        as enum ('ACTIVE', 'BLOCKED');
create type service_kind       as enum ('CONSULTANCY', 'ITR_FILING');

-- no CONSULT_MODE: v1 is video only
create type appointment_status as enum (
  'CONFIRMED',            -- the entry state; booking auto-confirms
  'RESCHEDULED',          -- terminal marker; superseded_by points at the successor
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN',
  'NO_SHOW'
);

create type itr_status as enum (
  'SUBMITTED',            -- user registered, awaiting admin
  'IN_REVIEW',
  'INFO_REQUESTED',       -- admin needs documents/details; ping-pongs with IN_REVIEW
  'IN_PROGRESS',
  'FILED',                -- return filed, acknowledgement number recorded
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN'
);

create type exception_kind  as enum ('BLOCKED', 'EXTRA');
create type thread_status   as enum ('AWAITING_ADMIN', 'AWAITING_USER', 'CLOSED');
create type sender_role     as enum ('USER', 'ADMIN');
create type enquiry_status  as enum ('NEW', 'READ', 'REPLIED', 'SPAM');
create type outbox_channel  as enum ('EMAIL', 'SMS');
create type outbox_status   as enum ('PENDING', 'SENT', 'FAILED', 'DEAD');
```

`PENDING` is gone from `appointment_status` — with auto‑confirm there is no state between "booked" and "confirmed", and leaving an unreachable enum value around invites someone to write a branch for it.

### 4.3 Tables

```sql
create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ─────────────────────────────────────────── users
create table user_profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text        not null,
  full_name            text,
  phone                text,
  address_line1        text,
  address_line2        text,
  city                 text,
  state                text,
  pincode              text,
  avatar_url           text,
  role                 user_role   not null default 'USER',
  status               user_status not null default 'ACTIVE',
  no_show_count        int         not null default 0,   -- feeds the abuse brake, §7.2
  profile_completed_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint phone_e164  check (phone   is null or phone   ~ '^\+[1-9][0-9]{7,14}$'),
  constraint pincode_fmt check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  constraint complete_profile_has_fields check (
    profile_completed_at is null
    or (full_name is not null and phone is not null and address_line1 is not null
        and city is not null and state is not null and pincode is not null)
  )
);
create unique index user_profiles_phone_key on user_profiles (phone) where phone is not null;
create index user_profiles_role_idx    on user_profiles (role);
create index user_profiles_created_idx on user_profiles (created_at desc);

-- ─────────────────────────────────────────── CA profile (exactly one row)
create table ca_profile (
  id                   boolean primary key default true check (id),
  full_name            text not null,
  headline             text,
  membership_number    text,
  firm_name            text,
  bio                  text,
  photo_url            text,
  years_experience     int check (years_experience between 0 and 70),
  qualifications       text[] not null default '{}',
  specialisations      text[] not null default '{}',
  languages            text[] not null default '{}',
  office_address       text,
  google_maps_url      text,
  contact_email        text,
  contact_phone        text,
  whatsapp_number      text,
  linkedin_url         text,
  default_meeting_url  text,                      -- ★ required before publishing, §5.3
  timezone             text    not null default 'Asia/Kolkata',
  is_published         boolean not null default false,
  updated_at           timestamptz not null default now(),

  constraint published_needs_meeting_url check (
    not is_published or default_meeting_url is not null
  )
);
```

That last constraint is the auto‑confirm decision expressed in SQL: you cannot publish a landing page that takes bookings until there is a meeting room to send people to.

```sql
-- ─────────────────────────────────────────── services
create table services (
  id               uuid primary key default gen_random_uuid(),
  kind             service_kind not null,
  name             text not null,
  slug             text not null unique,
  description      text,
  amount_paise     bigint not null check (amount_paise >= 0),
  currency         char(3) not null default 'INR',
  duration_minutes int check (duration_minutes is null or duration_minutes between 5 and 480),
  assessment_year  text check (assessment_year is null or assessment_year ~ '^AY [0-9]{4}-[0-9]{2}$'),
  itr_form_type    text,                          -- 'ITR-1' … 'ITR-7'
  is_active        boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint consultancy_needs_duration check (kind <> 'CONSULTANCY' or duration_minutes is not null),
  constraint itr_needs_year_and_form   check (kind <> 'ITR_FILING'  or (assessment_year is not null and itr_form_type is not null))
);
create index services_active_idx on services (kind, is_active, sort_order);
```

**Money is `bigint` paise.** Never `float`, never `numeric` in JS. ₹1,499.00 is `149900`.

```sql
-- ─────────────────────────────────────────── schedule
create table availability_rules (
  id             uuid primary key default gen_random_uuid(),
  day_of_week    int  not null check (day_of_week between 0 and 6),   -- 0 = Sunday
  start_time     time not null,
  end_time       time not null,
  slot_minutes   int  not null check (slot_minutes between 5 and 240),
  buffer_minutes int  not null default 0 check (buffer_minutes >= 0),
  effective_from date not null default current_date,
  effective_to   date,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),

  constraint window_ordered check (end_time > start_time),
  constraint dates_ordered  check (effective_to is null or effective_to >= effective_from)
);
create index availability_rules_dow_idx on availability_rules (day_of_week, is_active);

create table schedule_exceptions (
  id         uuid primary key default gen_random_uuid(),
  kind       exception_kind not null,
  on_date    date not null,
  start_time time,                                -- null + BLOCKED ⇒ whole day off
  end_time   time,
  reason     text,
  created_at timestamptz not null default now(),

  constraint extra_needs_times check (kind <> 'EXTRA' or (start_time is not null and end_time is not null)),
  constraint times_ordered     check (start_time is null or end_time is null or end_time > start_time)
);
create index schedule_exceptions_date_idx on schedule_exceptions (on_date);

-- ─────────────────────────────────────────── appointments (video consultations)
create table appointments (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique,            -- 'APT-2026-000418'
  user_id               uuid not null references user_profiles(id) on delete restrict,
  service_id            uuid not null references services(id) on delete restrict,

  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  slot                  tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,

  status                appointment_status not null default 'CONFIRMED',
  meeting_url           text not null,                   -- snapshotted at booking, §5.3

  service_name_snapshot text   not null,
  amount_paise_snapshot bigint not null,

  user_notes            text,
  admin_notes           text,                            -- never exposed to the user
  cancellation_reason   text,
  cancelled_at          timestamptz,
  completed_at          timestamptz,
  superseded_by         uuid references appointments(id),
  idempotency_key       text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint slot_ordered check (ends_at > starts_at),
  constraint admin_cancel_needs_reason check (
    status <> 'CANCELLED_BY_ADMIN' or cancellation_reason is not null
  ),
  -- ★ the database itself refuses double bookings
  constraint no_overlapping_active_appointments
    exclude using gist (slot with &&) where (status = 'CONFIRMED')
);
create unique index appointments_idempotency_key
  on appointments (user_id, idempotency_key) where idempotency_key is not null;
create index appointments_user_idx     on appointments (user_id, starts_at desc);
create index appointments_status_idx   on appointments (status, starts_at);
create index appointments_upcoming_idx on appointments (starts_at) where status = 'CONFIRMED';

create table appointment_status_history (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  from_status    appointment_status,
  to_status      appointment_status not null,
  changed_by     uuid references user_profiles(id),
  actor_role     sender_role not null,
  note           text,
  created_at     timestamptz not null default now()
);
create index apt_history_idx on appointment_status_history (appointment_id, created_at);
```

The `exclude using gist` constraint is the point. Two users clicking the same 11:00 slot at the same instant is a race no application‑level `SELECT … then INSERT` can close. Postgres closes it: the second insert fails with `23P01`, the repository translates it into a `SlotNoLongerAvailable` domain error, and the UI refetches slots. Verified under real concurrency in §17.

```sql
-- ─────────────────────────────────────────── ITR engagements (no time slot)
create table itr_engagements (
  id                     uuid primary key default gen_random_uuid(),
  reference              text not null unique,            -- 'ITR-2026-000042'
  user_id                uuid not null references user_profiles(id) on delete restrict,
  service_id             uuid not null references services(id) on delete restrict,

  status                 itr_status not null default 'SUBMITTED',
  assessment_year        text not null,
  itr_form_type          text not null,
  service_name_snapshot  text   not null,
  amount_paise_snapshot  bigint not null,

  pan_number             text,                            -- sensitive; see §14
  has_business_income    boolean not null default false,
  user_notes             text,
  admin_notes            text,
  info_requested         text,                            -- what the admin is waiting on
  acknowledgement_number text,                            -- ITR-V ack, set at FILED
  filed_at               timestamptz,
  cancellation_reason    text,
  cancelled_at           timestamptz,
  completed_at           timestamptz,
  idempotency_key        text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint pan_format      check (pan_number is null or pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  constraint filed_needs_ack check (status not in ('FILED','COMPLETED')
                                    or acknowledgement_number is not null),
  constraint info_request_has_text check (status <> 'INFO_REQUESTED' or info_requested is not null),
  constraint admin_cancel_needs_reason check (status <> 'CANCELLED_BY_ADMIN'
                                              or cancellation_reason is not null)
);
-- one live engagement per user per (assessment year, form type)
create unique index itr_one_live_per_year on itr_engagements (user_id, assessment_year, itr_form_type)
  where status not in ('CANCELLED_BY_USER','CANCELLED_BY_ADMIN');
create unique index itr_idempotency_key on itr_engagements (user_id, idempotency_key)
  where idempotency_key is not null;
create index itr_user_idx   on itr_engagements (user_id, created_at desc);
create index itr_status_idx on itr_engagements (status, created_at desc);

create table itr_status_history (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references itr_engagements(id) on delete cascade,
  from_status   itr_status,
  to_status     itr_status not null,
  changed_by    uuid references user_profiles(id),
  actor_role    sender_role not null,
  note          text,
  created_at    timestamptz not null default now()
);
create index itr_history_idx on itr_status_history (engagement_id, created_at);
```

**Why two tables rather than one `engagements` table with a nullable slot.** They share almost nothing: different status enums, different invariants (one has an exclusion constraint and a slot grid, the other has an acknowledgement number and a "one live per assessment year" rule), different lifecycles, different notification sets. Forcing them together means half the columns are null on every row and every use case starts with `if (kind === …)`. The only thing they genuinely share is "a user's dealings with the CA", and that's a **read** concern — §9 serves it with a union query, not a shared table.

```sql
-- ─────────────────────────────────────────── messaging (gated)
create table message_threads (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references user_profiles(id) on delete cascade,
  appointment_id   uuid references appointments(id)    on delete set null,
  engagement_id    uuid references itr_engagements(id) on delete set null,
  subject          text not null,
  status           thread_status not null default 'AWAITING_ADMIN',
  last_message_at  timestamptz not null default now(),
  unread_for_admin int not null default 0,
  unread_for_user  int not null default 0,
  created_at       timestamptz not null default now(),

  constraint at_most_one_context check (
    appointment_id is null or engagement_id is null
  )
);
create index threads_admin_inbox_idx on message_threads (status, last_message_at desc);
create index threads_user_idx        on message_threads (user_id, last_message_at desc);

create table messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references message_threads(id) on delete cascade,
  sender_id   uuid not null references user_profiles(id),
  sender_role sender_role not null,
  body        text not null check (length(btrim(body)) between 1 and 5000),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index messages_thread_idx on messages (thread_id, created_at);
```

Note what is **not** here: a check constraint enforcing "the user must have an engagement". That rule depends on the state of other tables at a point in time, which a check constraint cannot see. It lives in `MessagingPolicy` (§7.1) and is enforced by the use case — where it can be unit‑tested and where the error message can be helpful.

```sql
-- ─────────────────────────────────────────── contact enquiries (visitors)
create table contact_enquiries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) between 2 and 120),
  email      text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone      text check (phone is null or phone ~ '^\+?[0-9]{10,15}$'),
  subject    text not null check (length(btrim(subject)) between 3 and 200),
  body       text not null check (length(btrim(body)) between 10 and 3000),
  status     enquiry_status not null default 'NEW',
  admin_note text,
  replied_at timestamptz,
  source_ip  inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index enquiries_inbox_idx on contact_enquiries (status, created_at desc);
create index enquiries_ip_idx    on contact_enquiries (source_ip, created_at desc);  -- abuse triage

-- ─────────────────────────────────────────── notifications (transactional outbox)
create table notification_outbox (
  id            uuid primary key default gen_random_uuid(),
  channel       outbox_channel not null,
  recipient     text not null,
  template_key  text not null,                    -- 'appointment.confirmed'
  payload       jsonb not null,
  dedupe_key    text unique,                      -- 'apt:<id>:confirmed'
  status        outbox_status not null default 'PENDING',
  attempts      int not null default 0,
  next_retry_at timestamptz not null default now(),
  scheduled_for timestamptz,                      -- future-dated: 24h reminders
  last_error    text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index outbox_pending_idx on notification_outbox (status, next_retry_at)
  where status = 'PENDING';

-- ─────────────────────────────────────────── audit
create table audit_log (
  id          bigserial primary key,
  actor_id    uuid references user_profiles(id),
  action      text not null,
  entity_type text not null,
  entity_id   text,
  diff        jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);
create index audit_log_idx on audit_log (entity_type, entity_id, created_at desc);
```

### 4.4 Row Level Security

The API holds the service role key, so RLS does not gate normal traffic — the **use cases** do. RLS exists so that a leaked `anon` key yields nothing:

```sql
alter table user_profiles enable row level security;
alter table appointments  enable row level security;
alter table itr_engagements enable row level security;
-- … every table. No policies created ⇒ default-deny for anon and authenticated.
-- service_role bypasses RLS entirely.
```

### 4.5 Triggers

`updated_at` touching, and the human‑readable references (`APT-2026-000418`, `ITR-2026-000042`) from two sequences. Status history is written by the **use case** inside the unit of work — not by a trigger. Triggers carrying business meaning are invisible to unit tests and to anyone reading the code.

---

## 5. Booking, now that it auto-confirms

### 5.1 The slot generator

```ts
// domain/scheduling/slot-generator.ts — pure, no I/O, no Date.now()
export function generateSlots(q: SlotQuery, ctx: SlotContext): DaySlots[]
```

Per date in range: collect active rules for that `day_of_week` whose effective range covers the date → add `EXTRA` windows → subtract `BLOCKED` windows → convert local times to instants in the profile timezone → walk each window in `slot_minutes` steps, requiring `duration + buffer` to fit entirely inside → drop candidates overlapping a `CONFIRMED` appointment → drop candidates before `now + minLeadTime` or beyond `now + maxAdvanceDays`.

Because it is pure and takes `now` as a parameter, every DST and boundary case is a table‑driven test running in microseconds.

### 5.2 Booking policy

| Setting | Default | Meaning |
|---|---|---|
| `minLeadTimeMinutes` | 120 | Can't book less than 2 h out |
| `maxAdvanceDays` | 60 | Can't book more than 60 days out |
| `cancelWindowHours` | **12** | User may self‑cancel up to 12 h before |
| `maxUpcomingPerUser` | 3 | Simultaneous confirmed future appointments |
| `maxBookingsPerUserPerDay` | 2 | Rate brake on booking churn |
| `noShowLockoutThreshold` | 3 | After 3 no‑shows, booking requires admin unblock |

### 5.3 The meeting link — a direct consequence of auto-confirm

With an admin approval step, someone would paste a meeting link before the user ever saw a confirmation. With auto‑confirm there is no such moment: **the confirmation email goes out seconds after booking, and it has to contain a working join link.**

The v1 answer:

1. `ca_profile.default_meeting_url` holds the CA's permanent room — a Google Meet nickname room, a Zoom Personal Meeting Room, a Jitsi room. The `published_needs_meeting_url` constraint makes this mandatory before the landing page can go live.
2. `BookAppointment` **snapshots** it into `appointments.meeting_url` at booking time. Changing the default later does not silently rewrite the link on appointments already confirmed.
3. An admin can override `meeting_url` on a single appointment, which enqueues a "your meeting link has changed" email.

**The trade‑off to be aware of:** a permanent room means a back‑to‑back client could walk into the previous consultation. Two mitigations, both cheap: set `buffer_minutes` to 5–10 on availability rules so slots never touch, and enable the waiting room / "host must admit" setting in whichever provider you use. The v2 fix is a `MeetingProvider` port with a Google Meet or Zoom adapter minting a unique link per booking — the port boundary is already in the design, so that swap touches one adapter and no use case.

---

## 6. State machines

### 6.1 Appointment

```
[user books] ──→ CONFIRMED ──┬── admin marks done (now ≥ startsAt) ──→ COMPLETED
                             ├── admin marks absent (now ≥ endsAt) ──→ NO_SHOW  (+1 no_show_count)
                             ├── user cancels (now ≤ start − 12h)  ──→ CANCELLED_BY_USER
                             ├── admin cancels (reason required)   ──→ CANCELLED_BY_ADMIN
                             └── reschedule ──→ RESCHEDULED, successor row CONFIRMED
```

| From | To | Who | Guard |
|---|---|---|---|
| `CONFIRMED` | `CANCELLED_BY_USER` | owner | `now ≤ startsAt − 12 h`, else 409 `CANCEL_WINDOW_CLOSED` |
| `CONFIRMED` | `CANCELLED_BY_ADMIN` | admin | `cancellation_reason` required |
| `CONFIRMED` | `COMPLETED` | admin | `now ≥ startsAt` |
| `CONFIRMED` | `NO_SHOW` | admin | `now ≥ endsAt`; increments `no_show_count` |
| `CONFIRMED` | `RESCHEDULED` | owner or admin | new slot free; user reschedule also honours the 12 h window |
| any terminal | anything | — | rejected, `AppointmentNotModifiable` |

### 6.2 ITR engagement

```
[user registers] ──→ SUBMITTED ──→ IN_REVIEW ⇄ INFO_REQUESTED
                                        │
                                        ▼
                                   IN_PROGRESS ──→ FILED ──→ COMPLETED
   any non-terminal ──→ CANCELLED_BY_USER (before IN_PROGRESS) | CANCELLED_BY_ADMIN (reason required)
```

| From | To | Who | Guard |
|---|---|---|---|
| `SUBMITTED` | `IN_REVIEW` | admin | — |
| `IN_REVIEW` | `INFO_REQUESTED` | admin | `info_requested` text required; opens/reuses a thread |
| `INFO_REQUESTED` | `IN_REVIEW` | admin | after the user responds |
| `IN_REVIEW` | `IN_PROGRESS` | admin | — |
| `IN_PROGRESS` | `FILED` | admin | `acknowledgement_number` required |
| `FILED` | `COMPLETED` | admin | — |
| `SUBMITTED` \| `IN_REVIEW` \| `INFO_REQUESTED` | `CANCELLED_BY_USER` | owner | not once work has started |
| any non‑terminal | `CANCELLED_BY_ADMIN` | admin | reason required |

Both machines are declared as a transition table in the domain layer and exercised exhaustively — every legal transition and every illegal one is a test case generated from the table, so adding a status without deciding its edges breaks the build.

---

## 7. Messaging gate and the visitor contact form

### 7.1 Who may open a thread

```ts
// domain/messaging/messaging-policy.ts — pure
export function canStartThread(input: {
  user: { status: UserStatus; profileComplete: boolean };
  engagements: { kind: 'APPOINTMENT' | 'ITR'; status: string }[];
  now: Instant;
}): Result<void, 'ACCOUNT_BLOCKED' | 'PROFILE_INCOMPLETE' | 'NO_ENGAGEMENT'>
```

A user may start a thread when they hold **at least one non‑cancelled appointment or ITR engagement**. A cancelled‑only history does not qualify; a completed consultation from last year does — follow‑up questions after the fact are exactly what the practice wants to field.

**Replying to an existing thread is always allowed**, even if the underlying engagement is later cancelled or completed. Killing a half‑finished conversation because the appointment ended is the kind of rule that looks tidy in a spec and infuriating in production. Only an admin closing the thread stops it.

The API expresses the gate as 403 `NO_ENGAGEMENT` with a `detail` the UI turns into "Book a consultation to message the CA directly — or use the contact form", with both links. A dead end with a link out of it.

### 7.2 Visitor contact form

`POST /public/contact-enquiries`, protected by four layers, cheapest first:

1. **Honeypot field** — a hidden input; filled means bot; accept with 202 and discard silently so the bot doesn't learn.
2. **Cloudflare Turnstile** — the widget token is verified server‑side against `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the secret key. Free, no puzzle for the user, usually invisible. Behind a `CaptchaVerifier` port, so tests inject an always‑pass or always‑fail fake and never touch the network.
3. **Rate limit** — 3 per IP per hour, 20 per IP per day.
4. **Minimum dwell time** — reject submissions under 3 seconds from render.

Enquiries land in a second tab of the admin inbox. The admin replies by email; there is no anonymous thread to maintain. If an enquirer later signs up and books, they become a normal user with normal messaging.

### 7.3 Abuse surface opened by auto-confirm

Removing the approval step means a signed‑in user can occupy the calendar unattended. The brakes, all in `BookingPolicy` and all unit‑tested: profile completion required (name, phone, full address), `maxUpcomingPerUser = 3`, `maxBookingsPerUserPerDay = 2`, 120‑minute minimum lead time, a 5/min rate limit on the booking route, and a lockout after `noShowLockoutThreshold` no‑shows that only an admin can clear. The admin retains `CANCELLED_BY_ADMIN` with a reason and can set any user to `BLOCKED`.

---

## 8. Authentication and authorisation

### 8.1 Flow

```
Browser                          Supabase Auth                 Fastify API
  │ signInWithOAuth('google') ───────→│
  │ ←──── session (access + refresh JWT, ES256) ──┐
  │ GET /api/v1/me  Authorization: Bearer <jwt> ──┼──────────→│ verify sig via JWKS (cached)
  │                                               │            load user_profiles by sub
  │                                               │            auto-provision on first sight
  │ ←──── { user, profileComplete: false } ───────┼───────────│
  │ (app routes to /onboarding)                   │
  │ PUT /api/v1/me/profile {name, phone, address} ┼──────────→│ sets profile_completed_at
```

Supabase issues **asymmetric (ES256)** access tokens, verified offline against `https://<project>.supabase.co/auth/v1/.well-known/jwks.json` using `jose`'s `createRemoteJWKSet` — no round‑trip per request, no shared secret in the API. `supabase-js` in the browser handles **only** the session; every data call goes to Fastify with the token attached by an interceptor.

### 8.2 Why the role is not in the JWT

A custom access token hook works, but (a) an SQL function becomes part of your authorisation logic, invisible to the API's tests, and (b) revoking admin only takes effect after the token refreshes. Reading `role` from `user_profiles` costs one indexed primary‑key lookup you're doing anyway, is instantly revocable, and is trivially fakeable in tests.

### 8.3 Guards

`requireAuth` (401) → `requireCompleteProfile` (403 `PROFILE_INCOMPLETE`) → `requireEngagement` (403 `NO_ENGAGEMENT`) → `requireAdmin` (403). A `BLOCKED` user fails `requireAuth` with 403 `ACCOUNT_BLOCKED`.

### 8.4 Admin bootstrap

`supabase/seed.sql` sets `user_profiles.role = 'ADMIN'` for the seeded account. The admin signs in with Google like anyone else. `role` is writable only through `PATCH /admin/users/:id/role`, which an admin cannot invoke on themselves.

---

## 9. API contract

Base `/api/v1`. Errors are `application/problem+json`:

```json
{ "type": "https://errors.ca-consult.app/slot-unavailable",
  "title": "That slot is no longer available", "status": 409,
  "code": "SLOT_UNAVAILABLE",
  "detail": "Another appointment was booked at 2026-09-20T11:00:00+05:30",
  "traceId": "01J8…" }
```

### Public — no auth

| Method | Path | Notes |
|---|---|---|
| `GET` | `/public/ca-profile` | 404 if unpublished; `default_meeting_url` **not** exposed |
| `GET` | `/public/services` | `?kind=CONSULTANCY\|ITR_FILING`, active only |
| `GET` | `/public/availability` | `?serviceId&from&to` → `DaySlots[]`; range capped at 62 days; `max-age=60` |
| `POST` | `/public/contact-enquiries` | Turnstile token + honeypot; 3/hr per IP; always 202 |

### Authenticated user

| Method | Path | Guards | Notes |
|---|---|---|---|
| `GET` | `/me` | auth | `{ profile, profileComplete, canMessage, unreadMessages }` |
| `PUT` | `/me/profile` | auth | sets `profile_completed_at` on first valid save |
| `GET` | `/me/engagements` | auth | **union read model** — appointments + ITR, one timeline, `?scope=upcoming\|past` |
| `POST` | `/appointments` | auth + complete | `Idempotency-Key`; `{ serviceId, startsAt, notes }` → **201 `CONFIRMED`** with `meetingUrl` |
| `GET` | `/appointments/:id` | auth + owner | `admin_notes` stripped |
| `POST` | `/appointments/:id/cancel` | auth + owner | `{ reason }`; enforces the 12 h window |
| `POST` | `/appointments/:id/reschedule` | auth + owner | `{ startsAt }`; creates successor, honours the window |
| `POST` | `/itr-engagements` | auth + complete | `{ serviceId, hasBusinessIncome, notes }` → 201 `SUBMITTED`. **No PAN field** — §14 |
| `GET` | `/itr-engagements/:id` | auth + owner | status, timeline, `info_requested` |
| `POST` | `/itr-engagements/:id/cancel` | auth + owner | blocked once `IN_PROGRESS` |
| `GET` `POST` | `/me/threads` | auth + **engagement** | `POST` is where `NO_ENGAGEMENT` fires |
| `GET` | `/me/threads/:id` | auth + owner | marks read |
| `POST` | `/me/threads/:id/messages` | auth + owner | **no engagement guard** — replies always allowed |

### Admin — `requireAdmin` on all

| Method | Path | Notes |
|---|---|---|
| `GET` `PUT` | `/admin/ca-profile` | incl. `default_meeting_url`, `is_published` |
| `GET` `POST` `PUT` `DELETE` | `/admin/services[/:id]` | delete is soft if referenced |
| `GET` `POST` `PUT` `DELETE` | `/admin/availability/rules[/:id]` | warns about future appointments falling outside new rules |
| `GET` `POST` `DELETE` | `/admin/availability/exceptions[/:id]` | a new `BLOCKED` window returns the conflicting appointments to resolve |
| `GET` | `/admin/users` | `?q&status&page` |
| `PATCH` | `/admin/users/:id/status` | `ACTIVE` / `BLOCKED` |
| `POST` | `/admin/users/:id/reset-no-shows` | clears the lockout |
| `GET` | `/admin/appointments` | `?status&from&to&q&page`; today's list is the default view |
| `PATCH` | `/admin/appointments/:id` | `{ status?, adminNotes?, meetingUrl?, cancellationReason? }` |
| `POST` | `/admin/appointments/:id/reschedule` | `{ startsAt, notifyUser }` |
| `GET` | `/admin/itr-engagements` | `?status&assessmentYear&q&page` |
| `PATCH` | `/admin/itr-engagements/:id` | status advance + `infoRequested` / `acknowledgementNumber` / **`panNumber`** (the only route that can write it) |
| `GET` `POST` `PATCH` | `/admin/threads[/:id][/messages]` | inbox, reply, close |
| `GET` `PATCH` | `/admin/contact-enquiries[/:id]` | second inbox tab; mark `READ` / `REPLIED` / `SPAM` |
| `GET` | `/admin/dashboard` | today's consultations, ITR pipeline by status, new users this week, unread messages + enquiries |

**Cross‑cutting:** `{ items, page, pageSize, total }` pagination; `Idempotency-Key` on both create endpoints; rate limits 5/min on booking, 3/hr per IP on enquiries, 10/min on messages; `x-request-id` on every response.

---

## 10. Testing strategy

### 10.1 Shape and gates

```
        ╱╲        e2e (Playwright)                 ~14 specs, the money paths
       ╱──╲       integration (Vitest + real PG)   every repo, every route
      ╱────╲      component (RTL + MSW)            forms, slot picker, guards
     ╱──────╲     unit (Vitest, no I/O)            domain + use cases — the bulk
```

CI gates: **`domain/` ≥ 95 %**, `application/` ≥ 90 %, overall ≥ 80 %. `infrastructure/` is deliberately ungated — integration tests cover it, and chasing a number there produces mock theatre.

### 10.2 The loop, outside-in

Per slice: failing route test via `app.inject()` → use‑case test against in‑memory fakes and a fixed clock → domain test for each rule → repository with an integration test against real Postgres → wire the route → refactor green. Fakes in `tests/fakes/` are real port implementations backed by `Map`s, not mocking‑library stubs; `InMemoryAppointmentRepository` enforces the overlap rule too, so use‑case tests exercise the same invariant the database does.

```ts
describe('BookAppointment', () => {
  it('confirms immediately and stamps the meeting url from the CA profile', async () => {
    const ctx = aTestContext({ clock: new FakeClock('2026-09-16T09:00:00+05:30') })
      .withCaProfile({ defaultMeetingUrl: 'https://meet.example/ca-room' })
      .withRule({ dayOfWeek: 5, start: '10:00', end: '13:00', slotMinutes: 30, buffer: 5 })
      .build();

    const r = await ctx.bookAppointment.execute({
      userId: ctx.users.complete.id, serviceId: ctx.services.consultation.id,
      startsAt: '2026-09-18T10:00:00+05:30',
    });

    expect(r).toBeOk();
    expect(r.value.status).toBe('CONFIRMED');
    expect(r.value.meetingUrl).toBe('https://meet.example/ca-room');
    expect(ctx.outbox.entries).toMatchObject([
      { channel: 'EMAIL', templateKey: 'appointment.confirmed' },
      { channel: 'EMAIL', templateKey: 'admin.appointment.booked' },
      { channel: 'EMAIL', templateKey: 'appointment.reminder', scheduledFor: expect.any(String) },
    ]);
    expect(ctx.outbox.entries.filter(e => e.channel === 'SMS')).toHaveLength(0);  // v1: email only
  });
});
```

### 10.3 Tests that must exist

**Slot generation** — no rules; rule shorter than the service; buffer pushing the last slot out; whole‑day and partial `BLOCKED`; `EXTRA` on a bare day; overlapping rules deduped; expired `effective_to`; exact `minLeadTime` boundary (inclusive); `maxAdvanceDays + 1` excluded; a confirmed appointment removing exactly one slot; month and year boundaries.

**Booking** — happy path writes appointment + history + three outbox rows in one transaction and returns `CONFIRMED`; unpublished CA profile with no meeting URL → 409; incomplete profile → 403; blocked user → 403; past slot → 409; off‑grid slot (10:07) → 409; inactive service → 404; 4th upcoming booking → 429; 3rd booking today → 429; user at the no‑show lockout → 403; same `Idempotency-Key` twice returns the same appointment and creates one row.

**Concurrency** — two `POST /appointments` for the same slot via `Promise.all`: exactly one 201, one 409. Without this test the exclusion constraint is a hope.

**Appointment lifecycle** — every legal and illegal transition from the table; cancel at 11 h 59 m before → 409; at 12 h 01 m → 200; admin cancel without reason → 400; `NO_SHOW` increments `no_show_count` and the 3rd one locks booking.

**ITR engagement** — register → `SUBMITTED` + outbox; second live engagement for the same AY and form → 409 `DUPLICATE_ENGAGEMENT`; a cancelled one does **not** block re‑registering; `FILED` without an acknowledgement number → 400; `INFO_REQUESTED` without text → 400; user cancel at `IN_PROGRESS` → 409; a registration payload carrying a `pan` field has it **ignored, not stored** (§14); an admin `PATCH` with PAN `ABCDE1234` → 400, with `ABCDE1234F` → 200; the engagement serialiser masks PAN as `ABCDE****F` for every non‑admin reader and omits it entirely from notification payloads.

**Messaging gate** — user with zero engagements → 403 `NO_ENGAGEMENT`; with only a cancelled appointment → 403; with a completed appointment from last year → 201; with a `SUBMITTED` ITR engagement → 201; **reply succeeds after the engagement is cancelled**; posting to a `CLOSED` thread reopens it; reading another user's thread → 404 not 403 (don't leak existence).

**Contact form** — valid submission with a passing captcha → 202 + row + admin email; failing captcha → 202 + **no row** (don't tell the bot); honeypot filled → 202 + no row; 4th in an hour from one IP → 429; 5‑character body → 400.

**Auth** — expired token → 401; wrong‑key signature → 401; a `USER` on every `/admin/*` route → 403, **parameterised over the whole route table** so a new admin route can't ship unguarded.

**Outbox** — entries written in the same transaction (roll back, assert no rows); worker retries with backoff; `dedupe_key` prevents duplicate sends; `attempts > 5` → `DEAD`; `scheduled_for` in the future is not picked up early; SMS entries are never created while `NOTIFY_SMS_ENABLED=false`.

### 10.4 Integration and e2e

`supabase start` gives real Postgres in CI; each test runs in a transaction rolled back afterwards, so constraint and trigger behaviour under test is the real thing — and **every migration is tested on every CI run**.

Real Google OAuth can't be scripted reliably, so the Playwright fixture mints a local Supabase session and writes it to a `storageState` reused per worker. Specs: visitor reads the landing page → signs in → completes profile → books → **sees `CONFIRMED` and a join link immediately**; the same slot is gone for a second user; admin blocks a date and the slot disappears; user cancels at 20 h (allowed) and at 6 h (refused with a clear message); user registers an ITR engagement and the admin walks it to `FILED`; a user with no engagement sees the contact form instead of the message box; a visitor submits the contact form and the admin sees it; keyboard‑only booking; mobile‑viewport booking.

### 10.5 CI

`lint + typecheck` → `unit` → `integration` (`supabase start`) → `build` → `e2e` (docker compose) → coverage gate. Target under 8 minutes.

---

## 11. Frontend

### 11.1 Using the Minimal UI kit honestly

The free `material-kit-react` ships six demo pages (Dashboard, Users, Products, Blog, Sign in, 404) under MIT. Take the **theme, layout shell, nav, and table/chart primitives**; delete Products and Blog. Keep `src/theme` in `shared/theme` and layer a brand override — a CA practice wants sober navy/slate, not the kit's default purple.

### 11.2 Routes

```
Public                                   Admin (/admin/*, requireAdmin)
  /                landing                 /admin              dashboard
  /services        charges & packages      /admin/profile      CA profile + meeting URL
  /book            slot picker             /admin/services     charges CRUD
  /itr             ITR registration        /admin/schedule     rules + exceptions calendar
  /contact         enquiry form + captcha  /admin/appointments today / upcoming / all
  /auth/callback   OAuth landing           /admin/itr          ITR pipeline board
  /onboarding      complete profile        /admin/users        list + detail
  /me              my engagements          /admin/inbox        threads
  /me/messages     threads (gated)         /admin/enquiries    visitor enquiries
```

`/me` is one timeline from `GET /me/engagements` — consultations and ITR engagements interleaved, each with its own status chip. Users think "my dealings with the CA", not "my appointments table".

### 11.3 Guards

```tsx
<Route element={<RequireAuth />}>
  <Route path="/onboarding" element={<CompleteProfilePage />} />
  <Route element={<RequireCompleteProfile />}>        {/* → /onboarding */}
    <Route path="/book" element={<BookingWizard />} />
    <Route path="/itr"  element={<ItrRegistration />} />
    <Route path="/me"   element={<MyEngagements />} />
    <Route element={<RequireEngagement />}>           {/* → /contact with an explainer */}
      <Route path="/me/messages" element={<Threads />} />
    </Route>
  </Route>
  <Route element={<RequireAdmin />}><Route path="/admin/*" element={<AdminShell />} /></Route>
</Route>
```

### 11.4 Data layer and the booking wizard

TanStack Query with a typed client; query keys beside the feature. Forms use `react-hook-form` + `zodResolver` over `packages/contracts`, so client and server reject the same input for the same reason.

The wizard is now **three steps, not five** — video‑only and auto‑confirm each removed one: `Choose service → Choose date & slot → Review & confirm`. The confirmation screen shows the join link and an "add to calendar" `.ics` download, because there is no pending state to explain. The booking mutation's `onError` for `SLOT_UNAVAILABLE` invalidates the availability query and says "someone just took that slot" — the race condition turned into decent UX rather than a stack trace.

---

## 12. Notifications — email in v1

Every notifying change writes a `notification_outbox` row **inside the same transaction**. A worker claims rows with `FOR UPDATE SKIP LOCKED`, sends, marks `SENT`, and backs off exponentially. Forty lines that remove both failure modes of sending inline: an appointment saved with no email sent, and an email sent for a transaction that rolled back.

| Event | User | Admin |
|---|---|---|
| Appointment booked | **Confirmed** — date, time, join link, `.ics` | New booking |
| 24 h before | Reminder with join link *(future‑dated outbox row)* | Tomorrow's schedule digest |
| Cancelled / rescheduled | Notice with reason or new time | If the user initiated it |
| Meeting link changed by admin | Updated link | — |
| ITR registered | Acknowledgement + what happens next | New ITR engagement |
| ITR status advanced | Status update; `INFO_REQUESTED` includes what's needed | — |
| ITR filed | Acknowledgement number | — |
| New message | If unread after 15 min | Same |
| Contact enquiry | Auto‑acknowledgement to the visitor | New enquiry |
| Profile completed | Welcome | — |

**Email:** Resend (or Supabase SMTP). Templates as React Email or MJML, rendered by the worker.

**SMS is built but dark.** `SmsSender` is a port; `Msg91SmsSender` is written and tested against a recorded fixture; `NoopSmsSender` is wired in the composition root while `NOTIFY_SMS_ENABLED=false`. The use cases already ask for SMS on the four templates that warrant it (confirmed, reminder, cancelled, rescheduled) — the flag decides whether an outbox row is created at all, so turning SMS on later is one env var and zero code changes.

⚠️ **The DLT question is still open.** Transactional SMS to Indian numbers requires TRAI **DLT registration** — a registered entity, an approved header (sender ID), and a pre‑approved template per message type, with approval taking days to weeks. Write the four SMS templates now as fixed strings with `{#var#}` slots matching DLT's format, so what you register is exactly what you send. **Please confirm whether the practice already has DLT registration** — if it does, SMS can ship in v1 by flipping the flag; if not, v1 is email‑only as planned. WhatsApp Business is the alternative worth pricing, with its own template approval flow.

---

## 13. Where the deferred features slot in

| Feature | What it needs |
|---|---|
| Online payments | `payments` table keyed to either engagement; `PaymentGateway` port; a `PAYMENT_PENDING` state ahead of `CONFIRMED` / `SUBMITTED`; a webhook route. `amount_paise_snapshot` already exists on both tables. |
| Document upload | `documents` table + Supabase Storage keyed `itr/<engagement_id>/`; signed URLs from the API. This is the natural companion to `INFO_REQUESTED` and is the first thing to add after v1. |
| Per‑booking meeting links | `MeetingProvider` port + Google Meet or Zoom adapter; `BookAppointment` calls it instead of reading `default_meeting_url`. One adapter, no use‑case changes. |
| In‑person / phone modes | Re‑add `consult_mode`, a `modes` column on services and availability rules, and a mode step in the wizard. Everything else is unaffected. |
| Multiple CAs | `ca_profile` gains real ids; `availability_rules` and `appointments` gain `ca_id`; the exclusion constraint becomes `exclude using gist (ca_id with =, slot with &&)`. |
| Realtime chat | Supabase Realtime on `messages` with a narrow RLS select policy. |

---

## 14. Handling PAN — settled

**PAN is not collected at registration.** The user registers an ITR engagement with a service, an assessment year and a note; the admin requests the PAN through the `INFO_REQUESTED` step when they need it, and records it on the engagement.

Three things follow:

1. `POST /itr-engagements` takes no `pan` field. It is not in the public form, so it never travels the rate‑limited, captcha‑adjacent registration path and cannot be harvested by someone probing that endpoint.
2. `itr_engagements.pan_number` stays in the schema, nullable, **admin‑writable only** — set via `PATCH /admin/itr-engagements/:id`. No user‑facing route can write it. The format check constraint still applies, so a typo is caught at the storage layer either way.
3. The handling rules apply from the moment it is stored, because a government identifier is a government identifier regardless of who typed it: masked everywhere except the admin engagement detail view (`ABCDE****F`), never in logs or error payloads, on the audit log's redaction list, out of every notification email, and cleared on cancelled engagements after the retention window.

This also keeps the **DPDP Act 2023** surface small: the practice is still a Data Fiduciary for it, but the data arrives through one deliberate admin action rather than sitting in every abandoned registration form.

---

## 15. Configuration

```
# apps/api/.env
NODE_ENV=development
PORT=3001
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=…          # server only — never in the web bundle
DATABASE_URL=postgresql://…          # direct connection for transactions
APP_TIMEZONE=Asia/Kolkata

BOOKING_MIN_LEAD_MINUTES=120
BOOKING_MAX_ADVANCE_DAYS=60
BOOKING_CANCEL_WINDOW_HOURS=12
BOOKING_MAX_UPCOMING_PER_USER=3
BOOKING_MAX_PER_USER_PER_DAY=2
BOOKING_NO_SHOW_LOCKOUT=3

NOTIFY_EMAIL_ENABLED=true
NOTIFY_SMS_ENABLED=false             # ← flip when DLT templates clear
RESEND_API_KEY=…
MSG91_AUTH_KEY=
MSG91_SENDER_ID=

TURNSTILE_SECRET_KEY=…
WEB_ORIGIN=http://localhost:5173

# apps/web/.env  (VITE_ vars are PUBLIC — everything here ships to the browser)
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=…
VITE_API_BASE_URL=http://localhost:3001/api/v1
VITE_TURNSTILE_SITE_KEY=…
```

`config/env.ts` parses with zod at boot and exits on failure — a missing key should kill the process at second zero, not surface as a 500 at 2 a.m. A CI check greps the web bundle for the service role key.

---

## 16. Build order — ten vertical slices

Each slice is end‑to‑end (migration → domain → use case → route → UI → tests) and independently demoable. Nothing is "the backend phase".

| # | Slice | Proves |
|---|---|---|
| 1 | **Walking skeleton** — monorepo, `/health`, Vite app, Supabase local, CI green, one unit + one e2e test | The pipeline, not the product |
| 2 | **Auth + onboarding** — Google sign‑in, JWKS verification, auto‑provision, profile completion, guards | The riskiest integration, done first |
| 3 | **CA profile + landing** — admin editor incl. meeting URL, public landing section | The publish constraint; establishes the admin shell |
| 4 | **Services & charges** — admin CRUD, public services page | Money handling, soft delete |
| 5 | **Schedule** — rules, exceptions, **slot generator**, `GET /public/availability` | The hardest domain logic, most unit tests |
| 6 | **Booking** — auto‑confirm, exclusion constraint, idempotency, `/me`, user cancel at 12 h | The core transaction and the concurrency test |
| 7 | **ITR engagements** — registration, the duplicate‑AY rule, admin pipeline to `FILED` | The second lifecycle; PAN decision lands here |
| 8 | **Admin operations** — appointment list, complete/no‑show/cancel/reschedule, dashboard | Both state machines, fully exercised |
| 9 | **Messaging + contact form** — gated threads, admin inbox, Turnstile enquiries | The gate policy and the abuse surface |
| 10 | **Notifications** — outbox worker, email templates, 24 h reminders, SMS behind the flag | Async work, future‑dated sends |

Slices 1–2 are the ones to get exactly right; 3 and 4 will feel fast because 1–2 did the work.

---

## 17. Verification

**Consistency pass.** Every endpoint in §9 maps to a use case in §3 and a table in §4; every screen in §11.2 maps to at least one endpoint; every entity in §4 is reachable from a route; every invariant in §5–§7 has a named test in §10.3.

**The schema in §4 was executed.** The full DDL was applied to a real PostgreSQL 16 instance and the constraints exercised:

| Check | Result |
|---|---|
| Whole schema applies cleanly (enums, tables, indexes, triggers, RLS) | ✅ |
| `exclude using gist` on a **generated stored** `tstzrange` column | ✅ valid on PG 16 |
| Second user booking 11:15–11:45 over an existing 11:00–11:30 | ✅ rejected, `SQLSTATE 23P01` |
| Adjacent booking 11:30–12:00 against 11:00–11:30 | ✅ allowed — the half‑open `'[)'` range makes back‑to‑back slots legal |
| Rebooking a slot after the holder cancels | ✅ allowed — the partial `where status = 'CONFIRMED'` clause works |
| **Two concurrent transactions racing the same slot** | ✅ one commits, one rejected; exactly 1 row remains |
| Publishing a CA profile with no `default_meeting_url` | ✅ rejected |
| `profile_completed_at` set with missing address fields | ✅ rejected |
| Phone `9876543210` (not E.164) | ✅ rejected |
| `CONSULTANCY` with no duration / `ITR_FILING` with no assessment year | ✅ both rejected |
| Second live ITR engagement, same user + AY + form type | ✅ rejected |
| Same pair again **after cancelling the first** | ✅ allowed — the partial unique index is right |
| `FILED` with no acknowledgement number | ✅ rejected |
| `INFO_REQUESTED` with no `info_requested` text | ✅ rejected |
| PAN `ABCDE1234` (malformed) / `ABCDE1234F` (valid) | ✅ rejected / accepted |
| `CANCELLED_BY_ADMIN` with no reason, both tables | ✅ rejected |
| Thread with both an appointment and an engagement attached | ✅ rejected |
| Contact enquiry with a 5‑character body | ✅ rejected |
| Same `idempotency_key` reused by one user / by a different user | ✅ rejected / accepted |
| `APT-2026-000001` and `ITR-2026-000001` generated by triggers | ✅ |

The concurrency result is the one that matters: session B blocked on session A's uncommitted insert, then failed the instant A committed. That is the double‑booking bug closed at the storage layer rather than papered over in application code — and with auto‑confirm it matters more than it did in v0.1, because there is no admin reviewing bookings to catch a collision by eye.

---

## 18. What's still open

1. **DLT registration** — §12. Does the practice already have it? Determines whether SMS ships in v1 or waits. Either way v1 is built email‑first, so this is not blocking.
2. **Meeting provider** — which permanent room: Google Meet, Zoom, or Jitsi? Affects only the waiting‑room advice in §5.3, but **the URL is needed before slice 3 can publish the landing page**, since `published_needs_meeting_url` refuses otherwise.

Everything else is decided. §14 (PAN) closed: admin‑collected via `INFO_REQUESTED`, never on the registration form.
