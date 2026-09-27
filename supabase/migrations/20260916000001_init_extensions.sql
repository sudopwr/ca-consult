-- ─────────────────────────────────────────────────────────────────────────────
-- 0001 · Extensions and shared helpers
--
-- Slice 1 ships no business tables. What it does ship is the migration
-- pipeline itself: this file runs in CI on every push, so the very first
-- schema change is already tested before anyone writes one.
--
-- btree_gist is here rather than in the appointments migration because the
-- exclusion constraint in slice 6 depends on it, and an extension is cheaper
-- to create early than to discover missing at the moment you need it.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- Every mutable table gets `updated_at` maintained by this one trigger
-- function. Note what it deliberately is NOT used for: status transitions and
-- anything else carrying business meaning stay in the use cases, where they
-- are visible to unit tests and to whoever reads the code next.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.touch_updated_at() is
  'Maintains updated_at. Bookkeeping only — never business logic.';
