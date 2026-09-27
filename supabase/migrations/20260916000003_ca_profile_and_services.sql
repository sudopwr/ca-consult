-- ─────────────────────────────────────────────────────────────────────────────
-- 0003 · CA profile and services (slices 3 and 4)
-- ─────────────────────────────────────────────────────────────────────────────

create type service_kind as enum ('CONSULTANCY', 'ITR_FILING');

-- Exactly one row, ever. The boolean primary key with a `check (id)` is the
-- cheapest way to say "singleton" to Postgres: `true` is the only legal value,
-- and the primary key stops a second one.
create table public.ca_profile (
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
  default_meeting_url  text,
  timezone             text    not null default 'Asia/Kolkata',
  is_published         boolean not null default false,
  updated_at           timestamptz not null default now(),

  -- Auto-confirm means the confirmation email leaves seconds after booking and
  -- must carry a working join link. So: no meeting room, no public landing page.
  constraint published_needs_meeting_url check (
    not is_published or default_meeting_url is not null
  )
);

alter table public.ca_profile enable row level security;

create trigger ca_profile_touch
  before update on public.ca_profile
  for each row execute function public.touch_updated_at();

comment on constraint published_needs_meeting_url on public.ca_profile is
  'Bookings auto-confirm, so a publishable profile must already have a room to send clients to.';

-- ─────────────────────────────────────────────────────────────────────────────

create table public.services (
  id               uuid primary key default gen_random_uuid(),
  kind             service_kind not null,
  name             text not null check (length(btrim(name)) between 2 and 160),
  slug             text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description      text,
  amount_paise     bigint not null check (amount_paise >= 0),
  currency         char(3) not null default 'INR',
  duration_minutes int check (duration_minutes is null or duration_minutes between 5 and 480),
  assessment_year  text check (assessment_year is null or assessment_year ~ '^AY [0-9]{4}-[0-9]{2}$'),
  itr_form_type    text check (itr_form_type is null or itr_form_type ~ '^ITR-[1-7]$'),
  is_active        boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint consultancy_needs_duration
    check (kind <> 'CONSULTANCY' or duration_minutes is not null),
  constraint itr_needs_year_and_form
    check (kind <> 'ITR_FILING' or (assessment_year is not null and itr_form_type is not null))
);

create index services_active_idx on public.services (kind, is_active, sort_order);

create trigger services_touch
  before update on public.services
  for each row execute function public.touch_updated_at();

alter table public.services enable row level security;

comment on column public.services.amount_paise is
  'Integer paise. Rs 1,499.00 is 149900. Never a float, never numeric in JS.';
