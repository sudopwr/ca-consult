-- ─────────────────────────────────────────────────────────────────────────────
-- 0005 · Appointments (slice 6)
--
-- Bookings auto-confirm: there is no PENDING state between "booked" and
-- "confirmed", and no unreachable enum value inviting someone to write a branch
-- for it.
-- ─────────────────────────────────────────────────────────────────────────────

create type appointment_status as enum (
  'CONFIRMED',
  'RESCHEDULED',          -- terminal marker; superseded_by points at the successor
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN',
  'NO_SHOW'
);

create sequence public.appointment_ref_seq;

create table public.appointments (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null unique,
  user_id               uuid not null references public.user_profiles(id) on delete restrict,
  service_id            uuid not null references public.services(id)      on delete restrict,

  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  slot                  tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,

  status                appointment_status not null default 'CONFIRMED',
  meeting_url           text not null,

  -- Snapshots. A price edit next month must not rewrite what someone booked
  -- today, and a renamed service must not rewrite their history.
  service_name_snapshot text   not null,
  amount_paise_snapshot bigint not null check (amount_paise_snapshot >= 0),

  user_notes            text check (user_notes is null or length(user_notes) <= 2000),
  admin_notes           text,                     -- never serialised to the user
  cancellation_reason   text,
  cancelled_at          timestamptz,
  completed_at          timestamptz,
  superseded_by         uuid references public.appointments(id) on delete set null,
  idempotency_key       text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint slot_ordered check (ends_at > starts_at),
  constraint admin_cancel_needs_reason
    check (status <> 'CANCELLED_BY_ADMIN' or cancellation_reason is not null),

  -- The double-booking race, closed at the storage layer. Two users clicking
  -- the same 11:00 slot in the same millisecond is not something an
  -- application-level SELECT-then-INSERT can prevent; this is.
  --
  -- The '[)' bounds matter: they make 11:30-12:00 legal against 11:00-11:30,
  -- so back-to-back slots work while genuine overlaps do not.
  constraint no_overlapping_active_appointments
    exclude using gist (slot with &&) where (status = 'CONFIRMED')
);

create unique index appointments_idempotency_key
  on public.appointments (user_id, idempotency_key) where idempotency_key is not null;
create index appointments_user_idx     on public.appointments (user_id, starts_at desc);
create index appointments_status_idx   on public.appointments (status, starts_at);
create index appointments_upcoming_idx on public.appointments (starts_at) where status = 'CONFIRMED';
create index appointments_service_idx  on public.appointments (service_id);

create trigger appointments_touch
  before update on public.appointments
  for each row execute function public.touch_updated_at();

-- References are cosmetic, so a trigger is the right place for them. Anything
-- carrying business meaning stays in the use cases, where tests can see it.
create or replace function public.assign_appointment_reference()
returns trigger language plpgsql as $$
begin
  if new.reference is null then
    new.reference := 'APT-'
      || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-'
      || lpad(nextval('public.appointment_ref_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger appointments_assign_reference
  before insert on public.appointments
  for each row execute function public.assign_appointment_reference();

alter table public.appointments enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────

create type actor_role as enum ('USER', 'ADMIN', 'SYSTEM');

create table public.appointment_status_history (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  from_status    appointment_status,
  to_status      appointment_status not null,
  changed_by     uuid references public.user_profiles(id) on delete set null,
  actor_role     actor_role not null,
  note           text,
  created_at     timestamptz not null default now()
);

create index apt_history_idx on public.appointment_status_history (appointment_id, created_at);

alter table public.appointment_status_history enable row level security;
