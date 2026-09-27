#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Constraint tests for the schema.
#
# Several of this system's most important guarantees are enforced by the
# database rather than by application code — no double booking, one live filing
# per assessment year, no unacknowledged filing, no publishable profile without
# a meeting room. A guarantee without a test is a hope, so these assert that
# Postgres refuses what it should.
#
# Each check runs in its own transaction and is rolled back, so the database is
# left exactly as it was found.
#
#   Usage:  DATABASE_URL=postgresql://... ./scripts/verify-schema.sh
#           (defaults to the local Supabase stack)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PASS=0; FAIL=0

U1='aaaaaaaa-0000-4000-a000-000000000001'
U2='aaaaaaaa-0000-4000-a000-000000000002'

# Fixtures every check starts from, inside the same rolled-back transaction.
read -r -d '' FIXTURES <<'SQL'
insert into auth.users(id, email) values
  ('aaaaaaaa-0000-4000-a000-000000000001','a@test.invalid'),
  ('aaaaaaaa-0000-4000-a000-000000000002','b@test.invalid') on conflict do nothing;
insert into user_profiles(id,email,full_name,phone,address_line1,city,state,pincode,profile_completed_at) values
  ('aaaaaaaa-0000-4000-a000-000000000001','a@test.invalid','A','+919000000001','L1','Pune','MH','411001',now()),
  ('aaaaaaaa-0000-4000-a000-000000000002','b@test.invalid','B','+919000000002','L1','Pune','MH','411002',now())
  on conflict (id) do nothing;
insert into ca_profile(id,full_name,default_meeting_url,is_published)
  values (true,'Test CA','https://meet.test/room',true)
  on conflict (id) do update set default_meeting_url=excluded.default_meeting_url;
insert into services(kind,name,slug,amount_paise,duration_minutes)
  values ('CONSULTANCY','Verify Consult','verify-consult',100000,30) on conflict (slug) do nothing;
insert into services(kind,name,slug,amount_paise,assessment_year,itr_form_type)
  values ('ITR_FILING','Verify ITR','verify-itr',100000,'AY 2026-27','ITR-1') on conflict (slug) do nothing;
SQL

# check <id> <FAIL|SUCCEED> <description> <sql>
check() {
  local id="$1" expect="$2" desc="$3" sql="$4"
  local out
  out=$(psql "$DB" -v ON_ERROR_STOP=1 -q <<EOF 2>&1
begin;
$FIXTURES
$sql
rollback;
EOF
)
  local status=$?
  local actual; [ $status -eq 0 ] && actual=SUCCEED || actual=FAIL

  if [ "$actual" = "$expect" ]; then
    PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %-4s %-58s %s\n' "$id" "$desc" "$expect"
  else
    FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %-4s %-58s expected %s, got %s\n' "$id" "$desc" "$expect" "$actual"
    echo "$out" | grep -E '^(ERROR|DETAIL)' | head -2 | sed 's/^/        /'
  fi
}

BOOK="insert into appointments(user_id,service_id,starts_at,ends_at,meeting_url,service_name_snapshot,amount_paise_snapshot)"
BOOK_IDEM="insert into appointments(user_id,service_id,starts_at,ends_at,meeting_url,service_name_snapshot,amount_paise_snapshot,idempotency_key)"
SVC="(select id from services where slug='verify-consult')"
ITR="(select id from services where slug='verify-itr')"
REG="insert into itr_engagements(user_id,service_id,assessment_year,itr_form_type,service_name_snapshot,amount_paise_snapshot)"

echo
echo "  Schema constraint tests · $(psql "$DB" -tAc 'select version()' | cut -d, -f1)"
echo

echo "  ── CA profile ──────────────────────────────────────────────────────────"
check A1 FAIL    "publishing with no meeting room" \
  "update ca_profile set default_meeting_url=null, is_published=true;"
check A2 SUCCEED "unpublishing without one" \
  "update ca_profile set default_meeting_url=null, is_published=false;"
check A3 FAIL    "a second CA profile row" \
  "insert into ca_profile(id,full_name) values (true,'Another');"

echo "  ── double booking ──────────────────────────────────────────────────────"
check B1 SUCCEED "booking a free slot" \
  "$BOOK values ('$U1',$SVC,'2027-03-01 11:00+05:30','2027-03-01 11:30+05:30','u','C',1);"
check B2 FAIL    "an overlapping booking by another client" \
  "$BOOK values ('$U1',$SVC,'2027-03-01 11:00+05:30','2027-03-01 11:30+05:30','u','C',1);
   $BOOK values ('$U2',$SVC,'2027-03-01 11:15+05:30','2027-03-01 11:45+05:30','u','C',1);"
check B3 SUCCEED "a back-to-back booking (half-open range)" \
  "$BOOK values ('$U1',$SVC,'2027-03-01 11:00+05:30','2027-03-01 11:30+05:30','u','C',1);
   $BOOK values ('$U2',$SVC,'2027-03-01 11:30+05:30','2027-03-01 12:00+05:30','u','C',1);"
check B4 SUCCEED "rebooking a slot after a cancellation" \
  "$BOOK values ('$U1',$SVC,'2027-03-01 11:00+05:30','2027-03-01 11:30+05:30','u','C',1);
   update appointments set status='CANCELLED_BY_USER' where starts_at='2027-03-01 11:00+05:30';
   $BOOK values ('$U2',$SVC,'2027-03-01 11:00+05:30','2027-03-01 11:30+05:30','u','C',1);"
check B5 FAIL    "an admin cancellation with no reason" \
  "$BOOK values ('$U1',$SVC,'2027-03-01 11:00+05:30','2027-03-01 11:30+05:30','u','C',1);
   update appointments set status='CANCELLED_BY_ADMIN' where starts_at='2027-03-01 11:00+05:30';"
check B6 SUCCEED "an admin cancellation with a reason" \
  "$BOOK values ('$U1',$SVC,'2027-03-01 11:00+05:30','2027-03-01 11:30+05:30','u','C',1);
   update appointments set status='CANCELLED_BY_ADMIN', cancellation_reason='In court'
     where starts_at='2027-03-01 11:00+05:30';"
check B7 FAIL    "an appointment that ends before it starts" \
  "$BOOK values ('$U1',$SVC,'2027-03-01 12:00+05:30','2027-03-01 11:00+05:30','u','C',1);"

echo "  ── profiles ────────────────────────────────────────────────────────────"
check C1 FAIL    "marking a profile complete with no address" \
  "insert into auth.users(id,email) values ('aaaaaaaa-0000-4000-a000-000000000009','c@test.invalid');
   insert into user_profiles(id,email,profile_completed_at)
     values ('aaaaaaaa-0000-4000-a000-000000000009','c@test.invalid',now());"
check C2 FAIL    "a phone number that is not E.164" \
  "update user_profiles set phone='9876543210' where id='$U1';"
check C3 FAIL    "a malformed PIN code" \
  "update user_profiles set pincode='41100' where id='$U1';"

echo "  ── services ────────────────────────────────────────────────────────────"
check D1 FAIL    "a consultation with no duration" \
  "insert into services(kind,name,slug,amount_paise) values ('CONSULTANCY','X','bad-c',1);"
check D2 FAIL    "an ITR service with no assessment year" \
  "insert into services(kind,name,slug,amount_paise) values ('ITR_FILING','Y','bad-i',1);"
check D3 FAIL    "a negative price" \
  "insert into services(kind,name,slug,amount_paise,duration_minutes)
     values ('CONSULTANCY','Z','neg',-100,30);"

echo "  ── ITR engagements ─────────────────────────────────────────────────────"
check E1 SUCCEED "registering a filing" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);"
check E2 FAIL    "a second live filing for the same year and form" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   $REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);"
check E3 SUCCEED "re-registering after cancelling" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   update itr_engagements set status='CANCELLED_BY_USER', cancelled_at=now();
   $REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);"
check E4 SUCCEED "the same year and form for a different client" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   $REG values ('$U2',$ITR,'AY 2026-27','ITR-1','I',1);"
check E5 FAIL    "a malformed PAN" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   update itr_engagements set pan_number='ABCDE1234';"
check E6 SUCCEED "a valid PAN" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   update itr_engagements set pan_number='ABCDE1234F';"
check E7 FAIL    "marking a return filed with no acknowledgement" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   update itr_engagements set status='FILED';"
check E8 SUCCEED "marking a return filed with an acknowledgement" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   update itr_engagements set status='FILED', acknowledgement_number='123', filed_at=now();"
check E9 FAIL    "requesting information with no text for the client" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   update itr_engagements set status='INFO_REQUESTED';"

echo "  ── messaging and enquiries ─────────────────────────────────────────────"
check F1 FAIL    "a thread attached to two engagements at once" \
  "$BOOK values ('$U1',$SVC,'2027-03-01 11:00+05:30','2027-03-01 11:30+05:30','u','C',1);
   $REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   insert into message_threads(user_id,subject,appointment_id,engagement_id)
     values ('$U1','Both',(select id from appointments limit 1),(select id from itr_engagements limit 1));"
check F2 SUCCEED "a thread attached to one engagement" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   insert into message_threads(user_id,subject,engagement_id)
     values ('$U1','One',(select id from itr_engagements limit 1));"
check F3 FAIL    "an empty message body" \
  "insert into message_threads(id,user_id,subject) values (gen_random_uuid(),'$U1','S');
   insert into messages(thread_id,sender_id,sender_role,body)
     values ((select id from message_threads limit 1),'$U1','USER','   ');"
check G1 FAIL    "an enquiry body under ten characters" \
  "insert into contact_enquiries(name,email,subject,body) values ('Bot','x@y.test','Hello there','short');"
check G2 FAIL    "an enquiry with a malformed email" \
  "insert into contact_enquiries(name,email,subject,body) values ('Vikram','not-an-email','Hello there','A real question here');"
check G3 SUCCEED "a genuine enquiry" \
  "insert into contact_enquiries(name,email,subject,body,source_ip)
     values ('Vikram','v@x.test','Capital gains','I sold a flat and need help.','203.0.113.9');"

echo "  ── idempotency and the outbox ──────────────────────────────────────────"
check H1 FAIL    "reusing an idempotency key for one client" \
  "$BOOK_IDEM values ('$U1',$SVC,'2027-03-02 11:00+05:30','2027-03-02 11:30+05:30','u','C',1,'K');
   $BOOK_IDEM values ('$U1',$SVC,'2027-03-03 11:00+05:30','2027-03-03 11:30+05:30','u','C',1,'K');"
check H2 SUCCEED "the same key from a different client" \
  "$BOOK_IDEM values ('$U1',$SVC,'2027-03-02 11:00+05:30','2027-03-02 11:30+05:30','u','C',1,'K');
   $BOOK_IDEM values ('$U2',$SVC,'2027-03-03 11:00+05:30','2027-03-03 11:30+05:30','u','C',1,'K');"
check I1 SUCCEED "a duplicate outbox dedupe key is a silent no-op" \
  "insert into notification_outbox(channel,recipient,template_key,payload,dedupe_key)
     values ('EMAIL','x@t.invalid','appointment.confirmed','{}'::jsonb,'dk') on conflict (dedupe_key) do nothing;
   insert into notification_outbox(channel,recipient,template_key,payload,dedupe_key)
     values ('EMAIL','x@t.invalid','appointment.confirmed','{}'::jsonb,'dk') on conflict (dedupe_key) do nothing;
   do \$\$ begin
     if (select count(*) from notification_outbox where dedupe_key='dk') <> 1
       then raise exception 'dedupe failed'; end if;
   end \$\$;"

echo "  ── generated references ────────────────────────────────────────────────"
check J1 SUCCEED "the appointment reference trigger fires" \
  "$BOOK values ('$U1',$SVC,'2027-03-01 11:00+05:30','2027-03-01 11:30+05:30','u','C',1);
   do \$\$ begin
     if (select reference from appointments order by created_at desc limit 1) !~ '^APT-[0-9]{4}-[0-9]{6}\$'
       then raise exception 'bad appointment reference'; end if;
   end \$\$;"
check J2 SUCCEED "the ITR reference trigger fires" \
  "$REG values ('$U1',$ITR,'AY 2026-27','ITR-1','I',1);
   do \$\$ begin
     if (select reference from itr_engagements order by created_at desc limit 1) !~ '^ITR-[0-9]{4}-[0-9]{6}\$'
       then raise exception 'bad ITR reference'; end if;
   end \$\$;"

echo
if [ $FAIL -eq 0 ]; then
  printf '  \033[32m%d checks behaved exactly as specified.\033[0m\n\n' "$PASS"
else
  printf '  \033[31m%d of %d checks did not behave as specified.\033[0m\n\n' "$FAIL" "$((PASS+FAIL))"
  exit 1
fi
