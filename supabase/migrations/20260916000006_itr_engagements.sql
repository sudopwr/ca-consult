-- ─────────────────────────────────────────────────────────────────────────────
-- 0006 · ITR engagements (slice 7)
--
-- A separate table from appointments, not a nullable slot column on it. They
-- share almost nothing: different statuses, different invariants (one has an
-- exclusion constraint and a slot grid, the other an acknowledgement number and
-- a one-live-per-assessment-year rule), different lifecycles, different
-- notifications. What they do share is "a user's dealings with the CA", and
-- that is a read concern — served by a union query, not a shared table.
-- ─────────────────────────────────────────────────────────────────────────────

create type itr_status as enum (
  'SUBMITTED',
  'IN_REVIEW',
  'INFO_REQUESTED',
  'IN_PROGRESS',
  'FILED',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_ADMIN'
);

create sequence public.itr_ref_seq;

create table public.itr_engagements (
  id                     uuid primary key default gen_random_uuid(),
  reference              text not null unique,
  user_id                uuid not null references public.user_profiles(id) on delete restrict,
  service_id             uuid not null references public.services(id)      on delete restrict,

  status                 itr_status not null default 'SUBMITTED',
  assessment_year        text not null,
  itr_form_type          text not null,
  service_name_snapshot  text   not null,
  amount_paise_snapshot  bigint not null check (amount_paise_snapshot >= 0),

  -- Admin-writable only. Not on the registration form, not in any user-facing
  -- payload: a government identifier should not sit in every abandoned form
  -- submission. The admin records it via INFO_REQUESTED when they need it.
  pan_number             text,
  has_business_income    boolean not null default false,
  user_notes             text check (user_notes is null or length(user_notes) <= 2000),
  admin_notes            text,
  info_requested         text,
  acknowledgement_number text,
  filed_at               timestamptz,
  cancellation_reason    text,
  cancelled_at           timestamptz,
  completed_at           timestamptz,
  idempotency_key        text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint pan_format
    check (pan_number is null or pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  constraint filed_needs_ack
    check (status not in ('FILED', 'COMPLETED') or acknowledgement_number is not null),
  constraint info_request_has_text
    check (status <> 'INFO_REQUESTED' or info_requested is not null),
  constraint admin_cancel_needs_reason
    check (status <> 'CANCELLED_BY_ADMIN' or cancellation_reason is not null)
);

-- One live engagement per user per assessment year and form type. Cancelled
-- ones are excluded, so a user who cancels can register again.
create unique index itr_one_live_per_year
  on public.itr_engagements (user_id, assessment_year, itr_form_type)
  where status not in ('CANCELLED_BY_USER', 'CANCELLED_BY_ADMIN');

create unique index itr_idempotency_key
  on public.itr_engagements (user_id, idempotency_key) where idempotency_key is not null;
create index itr_user_idx    on public.itr_engagements (user_id, created_at desc);
create index itr_status_idx  on public.itr_engagements (status, created_at desc);
create index itr_service_idx on public.itr_engagements (service_id);

create trigger itr_engagements_touch
  before update on public.itr_engagements
  for each row execute function public.touch_updated_at();

create or replace function public.assign_itr_reference()
returns trigger language plpgsql as $$
begin
  if new.reference is null then
    new.reference := 'ITR-'
      || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-'
      || lpad(nextval('public.itr_ref_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger itr_assign_reference
  before insert on public.itr_engagements
  for each row execute function public.assign_itr_reference();

alter table public.itr_engagements enable row level security;

create table public.itr_status_history (
  id            uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.itr_engagements(id) on delete cascade,
  from_status   itr_status,
  to_status     itr_status not null,
  changed_by    uuid references public.user_profiles(id) on delete set null,
  actor_role    actor_role not null,
  note          text,
  created_at    timestamptz not null default now()
);

create index itr_history_idx on public.itr_status_history (engagement_id, created_at);

alter table public.itr_status_history enable row level security;

comment on column public.itr_engagements.pan_number is
  'Admin-writable only, via PATCH /admin/itr-engagements/:id. Masked for every non-admin reader and excluded from all notification payloads.';
