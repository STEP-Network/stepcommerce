-- One-time setup when STEP Commerce shares a database with other apps
-- (Neon project "STEPnetwork one"). Everything lives in the dedicated
-- `stepcommerce` schema; nothing in `public` is touched.
--
-- Run as the database owner (e.g. neondb_owner) BEFORE `npm run migrate`:
--   1. Replace <CHOOSE-A-STRONG-PASSWORD> below.
--   2. Run this file against the shared database.
--   3. Set DATABASE_URL for the app to connect AS stepcommerce_app —
--      its default search_path makes all unqualified table names resolve
--      to the stepcommerce schema (works with the stateless Neon HTTP driver).

create schema if not exists stepcommerce;

do $$
begin
  if not exists (select from pg_roles where rolname = 'stepcommerce_app') then
    create role stepcommerce_app login password '<CHOOSE-A-STRONG-PASSWORD>';
  end if;
end $$;

grant usage, create on schema stepcommerce to stepcommerce_app;
alter role stepcommerce_app set search_path = stepcommerce;

-- pgcrypto provides gen_random_uuid(); extensions are database-wide.
create extension if not exists pgcrypto;
grant execute on all functions in schema public to stepcommerce_app;
