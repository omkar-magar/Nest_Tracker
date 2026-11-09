-- Runs first on a plain Postgres (Render). It recreates the few Supabase pieces that supabase/migrations
-- rely on, so those files run here UNCHANGED:
--   roles anon / authenticated / service_role, the auth.users table, and auth.uid().
-- auth.uid() reads the user id the API sets for each request (see server/db.js):
--   select set_config('app.user_id', '<uuid>', true)   -- true = this transaction only
-- Outside such a transaction it is null, exactly like an anonymous Supabase request.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

-- the API connects as the database owner and switches role per request (set local role ...)
grant anon, authenticated, service_role to current_user;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Same columns the Supabase files read or write (handle_new_user reads raw_user_meta_data).
-- encrypted_password holds a bcrypt hash; Supabase's $2a$ hashes are copied over as they are.
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  encrypted_password text not null,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}',
  session_version    int not null default 0,   -- bump to sign the user out everywhere (password reset)
  created_at         timestamptz not null default now(),
  last_sign_in_at    timestamptz
);
create unique index users_email_key on auth.users (lower(email));
alter table auth.users enable row level security;   -- no policies: only the owner (the API) can touch it

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
