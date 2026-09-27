-- ─────────────────────────────────────────────────────────────────────────────
-- 0004 · Availability rules and schedule exceptions (slice 5)
--
-- Note what is NOT here: a slots table. Slots are derived in memory from these
-- rules minus exceptions minus booked appointments. Pre-generating them would
-- mean every schedule edit has to reconcile thousands of future rows; deriving
-- them makes a schedule edit one UPDATE and the rest a pure function.
-- ─────────────────────────────────────────────────────────────────────────────

create type exception_kind as enum ('BLOCKED', 'EXTRA');

create table public.availability_rules (
  id             uuid primary key default gen_random_uuid(),
  day_of_week    int  not null check (day_of_week between 0 and 6),   -- 0 = Sunday
  start_time     time not null,
  end_time       time not null,
  slot_minutes   int  not null check (slot_minutes between 5 and 240),
  buffer_minutes int  not null default 0 check (buffer_minutes between 0 and 120),
  effective_from date not null default current_date,
  effective_to   date,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint window_ordered check (end_time > start_time),
  constraint dates_ordered  check (effective_to is null or effective_to >= effective_from)
);

create index availability_rules_dow_idx on public.availability_rules (day_of_week, is_active);

create trigger availability_rules_touch
  before update on public.availability_rules
  for each row execute function public.touch_updated_at();

alter table public.availability_rules enable row level security;

comment on column public.availability_rules.buffer_minutes is
  'Gap after each consultation. Worth 5-10 minutes: the CA uses one permanent meeting room, so touching slots let a client walk into the previous call.';

-- ─────────────────────────────────────────────────────────────────────────────

create table public.schedule_exceptions (
  id         uuid primary key default gen_random_uuid(),
  kind       exception_kind not null,
  on_date    date not null,
  start_time time,                    -- null on a BLOCKED row means the whole day
  end_time   time,
  reason     text,
  created_at timestamptz not null default now(),

  constraint extra_needs_times
    check (kind <> 'EXTRA' or (start_time is not null and end_time is not null)),
  constraint times_ordered
    check (start_time is null or end_time is null or end_time > start_time),
  constraint both_times_or_neither
    check ((start_time is null) = (end_time is null))
);

create index schedule_exceptions_date_idx on public.schedule_exceptions (on_date);

alter table public.schedule_exceptions enable row level security;
