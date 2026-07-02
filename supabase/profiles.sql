-- ─────────────────────────────────────────────────────────────────────────
-- Employee profiles + HR role migration. Run ONCE in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → Run).
--
-- Adds the 'hr' role, an employee_profiles table (one row per account), and a
-- public storage bucket for profile photos. The NOTIFY at the end refreshes
-- PostgREST's schema cache.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Allow the new 'hr' role on accounts.
alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check
  check (role in ('admin', 'agent', 'hr'));

-- 2) One employee profile per account. HR/admin edit; agents view their own.
create table if not exists employee_profiles (
  user_id            uuid primary key references app_users(id) on delete cascade,
  -- Identity
  last_name          text,
  first_name         text,
  middle_name        text,
  signal_nickname    text,
  photo_url          text,
  -- Contact
  mobile_number      text,
  carepack_email     text,
  getva_email        text,
  home_address       text,
  emergency_contact  text,
  -- Employment
  employee_id        text,
  position           text,
  department         text,
  wisetags           text,
  updated_at         timestamptz not null default now(),
  updated_by         text
);
alter table employee_profiles enable row level security;

-- 3) Public bucket for profile photos. Uploads go through the server
--    (service-role key), so no client-side storage policies are needed; public
--    read lets the <img> load the photo by URL.
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do nothing;

-- Reload PostgREST so the new table/role are visible to the API immediately.
notify pgrst, 'reload schema';
