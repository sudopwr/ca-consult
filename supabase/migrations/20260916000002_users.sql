-- ─────────────────────────────────────────────────────────────────────────────
-- 0002 · Users (slice 2)
--
-- One row per Supabase auth user, created lazily by the API the first time a
-- valid token arrives. `role` lives here rather than in the JWT so that
-- revoking admin takes effect on the next request instead of the next token
-- refresh, and so that authorisation is testable without minting tokens.
-- ─────────────────────────────────────────────────────────────────────────────

create type user_role   as enum ('USER', 'ADMIN');
create type user_status as enum ('ACTIVE', 'BLOCKED');

create table public.user_profiles (
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
  no_show_count        int         not null default 0 check (no_show_count >= 0),
  profile_completed_at timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint phone_e164  check (phone   is null or phone   ~ '^\+[1-9][0-9]{7,14}$'),
  constraint pincode_fmt check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),

  -- "Profile complete" is not a flag someone can set independently of the data.
  -- If the timestamp is present, the fields it claims are present must be too.
  constraint complete_profile_has_fields check (
    profile_completed_at is null
    or (full_name is not null and phone is not null and address_line1 is not null
        and city is not null and state is not null and pincode is not null)
  )
);

create unique index user_profiles_phone_key on public.user_profiles (phone) where phone is not null;
create index user_profiles_role_idx    on public.user_profiles (role);
create index user_profiles_created_idx on public.user_profiles (created_at desc);
create index user_profiles_email_idx   on public.user_profiles (lower(email));

create trigger user_profiles_touch
  before update on public.user_profiles
  for each row execute function public.touch_updated_at();

-- The API holds the service role key and enforces authorisation in its use
-- cases. RLS is enabled with no policies so that a leaked anon key reads
-- nothing at all — defence in depth, not the primary gate.
alter table public.user_profiles enable row level security;

comment on column public.user_profiles.profile_completed_at is
  'Null means onboarding is incomplete; the API redirects such users to /onboarding.';
comment on column public.user_profiles.no_show_count is
  'Feeds the booking lockout. Reset by an admin via POST /admin/users/:id/reset-no-shows.';
