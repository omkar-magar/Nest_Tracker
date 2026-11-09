-- One-time links sent by email: confirm an address, reset a password.
-- Only a SHA-256 hash of the token is stored, so a leaked database cannot be used to take over an account.
-- A token works once (used_at) and only before expires_at.

create table auth.tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('verify_email', 'reset_password')),
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index tokens_user_idx on auth.tokens (user_id, kind);
alter table auth.tokens enable row level security;   -- no policies: API (owner) only
