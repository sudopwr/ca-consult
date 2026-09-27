-- ─────────────────────────────────────────────────────────────────────────────
-- Local development seed. Runs on `supabase start`.
--
-- The admin is bootstrapped here because there is deliberately no endpoint that
-- can grant admin to yourself. This file is the only path.
--
-- Sign in locally with admin@ca-consult.test / password123 (email provider is
-- enabled in config.toml for local work; production uses Google only).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── auth users ───────────────────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at)
values
  ('00000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin@ca-consult.test',
   crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"S. Mehta"}', now(), now()),
  ('00000000-0000-4000-a000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'client@ca-consult.test',
   crypt('password123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Ananya Rao"}', now(), now())
on conflict (id) do nothing;

-- ── profiles ─────────────────────────────────────────────────────────────────
insert into public.user_profiles (id, email, full_name, phone, address_line1, city,
                                  state, pincode, role, profile_completed_at)
values
  ('00000000-0000-4000-a000-000000000001', 'admin@ca-consult.test', 'S. Mehta',
   '+919810000001', '304 Trade Centre, Bandra Kurla Complex', 'Mumbai', 'Maharashtra',
   '400051', 'ADMIN', now()),
  ('00000000-0000-4000-a000-000000000002', 'client@ca-consult.test', 'Ananya Rao',
   '+919810000002', '12 Sunder Nagar', 'Pune', 'Maharashtra', '411001', 'USER', now())
on conflict (id) do nothing;

-- ── CA profile ───────────────────────────────────────────────────────────────
-- default_meeting_url is set, otherwise published_needs_meeting_url refuses to
-- let is_published be true — which is the intended behaviour, not an obstacle.
insert into public.ca_profile (
  id, full_name, headline, membership_number, firm_name, bio, years_experience,
  qualifications, specialisations, languages, office_address, contact_email,
  contact_phone, default_meeting_url, is_published)
values (
  true, 'S. Mehta', 'Chartered Accountant | 14 years in practice', '123456',
  'Mehta & Associates',
  'Individual and small-business tax practice in Mumbai. Income tax returns, '
  'GST compliance, tax planning and representation before the department.',
  14,
  array['CA', 'B.Com (Hons)', 'DISA'],
  array['ITR Filing', 'GST Compliance', 'Tax Planning', 'Statutory Audit'],
  array['English', 'Hindi', 'Marathi'],
  '304 Trade Centre, Bandra Kurla Complex, Mumbai 400051',
  'contact@mehta-associates.test', '+912266000000',
  'https://meet.google.com/abc-defg-hij', true)
on conflict (id) do nothing;

-- ── services ─────────────────────────────────────────────────────────────────
insert into public.services (kind, name, slug, description, amount_paise,
                             duration_minutes, assessment_year, itr_form_type, sort_order)
values
  ('CONSULTANCY', 'Tax Planning Consultation', 'tax-planning',
   'Thirty minutes on salary structuring, deductions and advance tax.',
   149900, 30, null, null, 1),
  ('CONSULTANCY', 'GST Advisory', 'gst-advisory',
   'Registration, returns, input credit and notices.', 199900, 45, null, null, 2),
  ('CONSULTANCY', 'Quick Query', 'quick-query',
   'Fifteen minutes for a single specific question.', 79900, 15, null, null, 3),
  ('ITR_FILING', 'ITR-1 · Salaried', 'itr-1-salaried',
   'Salary, one house property, other sources. Includes review and e-filing.',
   99900, null, 'AY 2026-27', 'ITR-1', 10),
  ('ITR_FILING', 'ITR-2 · Capital Gains', 'itr-2-capital-gains',
   'Salary plus capital gains, multiple properties, foreign assets.',
   249900, null, 'AY 2026-27', 'ITR-2', 11),
  ('ITR_FILING', 'ITR-3 · Business & Profession', 'itr-3-business',
   'Proprietors and professionals, with books of account.',
   449900, null, 'AY 2026-27', 'ITR-3', 12)
on conflict (slug) do nothing;

-- ── availability: Mon-Fri 10:00-13:00 and 15:00-18:00, 30-minute slots ───────
insert into public.availability_rules (day_of_week, start_time, end_time,
                                       slot_minutes, buffer_minutes)
select d, t.s, t.e, 30, 5
from generate_series(1, 5) as d,
     (values (time '10:00', time '13:00'), (time '15:00', time '18:00')) as t(s, e);

-- Saturday mornings only.
insert into public.availability_rules (day_of_week, start_time, end_time,
                                       slot_minutes, buffer_minutes)
values (6, '10:00', '13:00', 30, 5);
