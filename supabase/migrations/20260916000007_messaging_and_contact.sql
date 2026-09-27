-- ─────────────────────────────────────────────────────────────────────────────
-- 0007 · Messaging and visitor enquiries (slice 9)
--
-- There is deliberately no constraint here enforcing "the user must hold an
-- engagement to open a thread". That rule depends on the state of two other
-- tables at a point in time, which a check constraint cannot see. It lives in
-- MessagingPolicy, where it can be unit-tested and where the refusal can carry
-- a helpful message and a link to the contact form.
-- ─────────────────────────────────────────────────────────────────────────────

create type thread_status  as enum ('AWAITING_ADMIN', 'AWAITING_USER', 'CLOSED');
create type sender_role    as enum ('USER', 'ADMIN');
create type enquiry_status as enum ('NEW', 'READ', 'REPLIED', 'SPAM');

create table public.message_threads (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.user_profiles(id)   on delete cascade,
  appointment_id   uuid references public.appointments(id)             on delete set null,
  engagement_id    uuid references public.itr_engagements(id)          on delete set null,
  subject          text not null check (length(btrim(subject)) between 3 and 200),
  status           thread_status not null default 'AWAITING_ADMIN',
  last_message_at  timestamptz not null default now(),
  unread_for_admin int not null default 0 check (unread_for_admin >= 0),
  unread_for_user  int not null default 0 check (unread_for_user  >= 0),
  created_at       timestamptz not null default now(),

  constraint at_most_one_context check (appointment_id is null or engagement_id is null)
);

create index threads_admin_inbox_idx on public.message_threads (status, last_message_at desc);
create index threads_user_idx        on public.message_threads (user_id, last_message_at desc);

alter table public.message_threads enable row level security;

create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.message_threads(id) on delete cascade,
  sender_id   uuid not null references public.user_profiles(id)   on delete restrict,
  sender_role sender_role not null,
  body        text not null check (length(btrim(body)) between 1 and 5000),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index messages_thread_idx on public.messages (thread_id, created_at);

alter table public.messages enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Visitors cannot open a thread, so they get this instead: a one-way enquiry,
-- captcha-verified, answered by email. No anonymous conversation to maintain.

create table public.contact_enquiries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name))    between 2 and 120),
  email      text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone      text check (phone is null or phone ~ '^\+?[0-9]{10,15}$'),
  subject    text not null check (length(btrim(subject)) between 3 and 200),
  body       text not null check (length(btrim(body))    between 10 and 3000),
  status     enquiry_status not null default 'NEW',
  admin_note text,
  replied_at timestamptz,
  source_ip  inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index enquiries_inbox_idx on public.contact_enquiries (status, created_at desc);
create index enquiries_ip_idx    on public.contact_enquiries (source_ip, created_at desc);

alter table public.contact_enquiries enable row level security;
