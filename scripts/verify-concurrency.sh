#!/usr/bin/env bash
# Two clients, one slot, same instant.
#
# This is the race the exclusion constraint exists for, and the one that cannot
# be closed by an application-level check-then-insert. Without this test that
# constraint is a hope rather than a guarantee.
set -uo pipefail
DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

SLOT="2027-06-15 10:00+05:30"
END="2027-06-15 10:30+05:30"

psql "$DB" -q <<'SQL'
insert into auth.users(id,email) values
  ('cccccccc-0000-4000-a000-000000000001','race1@test.invalid'),
  ('cccccccc-0000-4000-a000-000000000002','race2@test.invalid') on conflict do nothing;
insert into user_profiles(id,email,full_name,phone,address_line1,city,state,pincode,profile_completed_at) values
  ('cccccccc-0000-4000-a000-000000000001','race1@test.invalid','R1','+919000000101','L','Pune','MH','411001',now()),
  ('cccccccc-0000-4000-a000-000000000002','race2@test.invalid','R2','+919000000102','L','Pune','MH','411002',now())
  on conflict (id) do nothing;
insert into services(kind,name,slug,amount_paise,duration_minutes)
  values ('CONSULTANCY','Race','race-consult',100000,30) on conflict (slug) do nothing;
delete from appointments where starts_at = '2027-06-15 10:00+05:30';
SQL

book() {
  psql "$DB" -q -v ON_ERROR_STOP=1 <<SQL >/dev/null 2>&1
begin;
insert into appointments(user_id,service_id,starts_at,ends_at,meeting_url,
                         service_name_snapshot,amount_paise_snapshot)
values ('$1',(select id from services where slug='race-consult'),
        '$SLOT','$END','u','Race',100000);
select pg_sleep($2);
commit;
SQL
  echo "$?"
}

echo
echo "  Two transactions racing for $SLOT"
echo

A=$(book 'cccccccc-0000-4000-a000-000000000001' 1) & PA=$!
sleep 0.25
B=$(book 'cccccccc-0000-4000-a000-000000000002' 0) & PB=$!
wait $PA $PB

ROWS=$(psql "$DB" -tAc "select count(*) from appointments
  where starts_at='$SLOT' and status='CONFIRMED'")

psql "$DB" -q -c "delete from appointments where starts_at='$SLOT'"

echo "  surviving CONFIRMED rows for that slot: $ROWS"
echo
if [ "$ROWS" = "1" ]; then
  printf '  \033[32mExactly one booking survived. The exclusion constraint held.\033[0m\n\n'
else
  printf '  \033[31mExpected exactly 1 surviving booking, found %s.\033[0m\n\n' "$ROWS"
  exit 1
fi
