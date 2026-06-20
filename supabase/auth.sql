-- ─────────────────────────────────────────────────────────────────────────
-- Dashboard auth migration. Run ONCE in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → Run).
--
-- The service/secret key CANNOT run DDL or reload the API, so this must be run
-- in the SQL Editor. The NOTIFY at the end refreshes PostgREST's schema cache;
-- without it the API returns "Could not find the table app_users in the schema
-- cache".
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,                              -- stored lowercased
  password_hash text not null,
  role          text not null default 'agent' check (role in ('admin','agent')),
  agent_name    text,                                              -- exact tawk display name (agents)
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table app_users enable row level security;

-- Reload PostgREST so the new table is visible to the API immediately.
notify pgrst, 'reload schema';
