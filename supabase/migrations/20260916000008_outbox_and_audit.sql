-- ─────────────────────────────────────────────────────────────────────────────
-- 0008 · Notification outbox and audit log (slice 10)
--
-- Every notifying change writes its outbox row inside the same transaction as
-- the business change. That removes both failure modes of sending inline: an
-- appointment saved with no email sent, and an email sent for a transaction
-- that then rolled back.
-- ─────────────────────────────────────────────────────────────────────────────

create type outbox_channel as enum ('EMAIL', 'SMS');
create type outbox_status  as enum ('PENDING', 'SENT', 'FAILED', 'DEAD');

create table public.notification_outbox (
  id            uuid primary key default gen_random_uuid(),
  channel       outbox_channel not null,
  recipient     text not null,
  template_key  text not null,
  payload       jsonb not null default '{}'::jsonb,

  -- Idempotency for sends. 'apt:<id>:confirmed' can only ever exist once, so a
  -- retried use case or a replayed message cannot email someone twice.
  dedupe_key    text unique,

  status        outbox_status not null default 'PENDING',
  attempts      int not null default 0 check (attempts >= 0),
  next_retry_at timestamptz not null default now(),

  -- Future-dated rows are how 24-hour reminders work: written at booking time,
  -- invisible to the worker until their moment arrives.
  scheduled_for timestamptz,

  last_error    text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

-- The worker's only query. Partial so the index stays small as SENT rows pile up.
create index outbox_pending_idx
  on public.notification_outbox (next_retry_at, coalesce(scheduled_for, created_at))
  where status = 'PENDING';

create index outbox_status_idx on public.notification_outbox (status, created_at desc);

alter table public.notification_outbox enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

create table public.audit_log (
  id          bigserial primary key,
  actor_id    uuid references public.user_profiles(id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  diff        jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);

create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);
create index audit_log_actor_idx  on public.audit_log (actor_id, created_at desc);

alter table public.audit_log enable row level security;

comment on table public.audit_log is
  'Admin mutations. PAN and other sensitive values are redacted by the writer before the diff is stored.';
