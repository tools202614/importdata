-- ─────────────────────────────────────────────────────────────────────────
-- Supabase schema for the Tawk.to dashboard.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query → Run).
--
-- All app access is server-side via the SECRET (service-role) key, which bypasses
-- RLS. RLS is enabled with NO public policies, so the publishable/anon key cannot
-- read or write these tables.
-- ─────────────────────────────────────────────────────────────────────────

-- Synced tawk.to chats (raw object kept verbatim so reports use the same logic).
create table if not exists chats (
  id          text primary key,
  property_id text not null,
  property    text not null,
  created_on  timestamptz,
  updated_on  timestamptz,
  raw         jsonb not null,
  synced_at   timestamptz not null default now()
);
create index if not exists chats_created_on_idx on chats (created_on);
create index if not exists chats_property_idx    on chats (property);

-- Synced tawk.to tickets.
create table if not exists tickets (
  id          text primary key,
  human_id    bigint,
  property_id text not null,
  property    text not null,
  created_on  timestamptz,
  updated_on  timestamptz,
  raw         jsonb not null,
  synced_at   timestamptz not null default now()
);
create index if not exists tickets_created_on_idx on tickets (created_on);
create index if not exists tickets_property_idx    on tickets (property);

-- Operational escalation records (Channel Issue / VOD Issue / Chargeback …).
create table if not exists escalations (
  id          uuid primary key default gen_random_uuid(),
  form_id     text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists escalations_form_id_idx    on escalations (form_id);
create index if not exists escalations_created_at_idx  on escalations (created_at desc);

-- Custom contact attribute definitions (reference, synced from tawk.to).
create table if not exists custom_attributes (
  property_id text not null,
  property    text not null,
  object      text not null,         -- 'person' | 'organization'
  key         text not null,
  label       text,
  data_type   text,
  synced_at   timestamptz not null default now(),
  primary key (property_id, object, key)
);

-- ── Daily summary tables (auto-populated by the daily aggregation job) ──────

-- One row per property per day: the headline counts.
create table if not exists daily_counts (
  day          date not null,
  property_id  text not null,
  property     text not null,
  chat_volume  integer not null default 0,
  missed       integer not null default 0,
  offline      integer not null default 0,
  tickets      integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (day, property_id)
);
create index if not exists daily_counts_day_idx on daily_counts (day);

-- One row per property per day per driver/tag: chat & ticket counts by driver.
create table if not exists chat_drivers_daily (
  day          date not null,
  property_id  text not null,
  property     text not null,
  driver       text not null,        -- tawk tag (the de-facto driver)
  chats        integer not null default 0,
  tickets      integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (day, property_id, driver)
);
create index if not exists chat_drivers_daily_day_idx on chat_drivers_daily (day);

-- Bookkeeping for the sync job (single row, id = 'tawk').
create table if not exists sync_state (
  id              text primary key,
  last_synced_at  timestamptz,
  detail          jsonb
);

-- The Chats list: one row per chat/ticket. Conversation metadata (populated by
-- the sync AND by realtime webhooks) plus the reviewer's manual tags. Metadata
-- upserts never include the tag columns, so review selections are preserved.
create table if not exists chat_tags (
  id                        text primary key,
  type                      text not null,                 -- 'chat' | 'ticket'
  property_id               text,
  property                  text,
  channel_user              text,
  email                     text,
  phone                     text,
  agent                     text,                          -- last-touch agent
  created_on                timestamptz,                   -- chat created / start
  last_seen                 timestamptz,
  drivers                   jsonb not null default '[]'::jsonb,
  drivers_updated_at        timestamptz,
  channel_issue             jsonb not null default '[]'::jsonb,
  channel_issue_updated_at  timestamptz,
  synced_at                 timestamptz
);
create index if not exists chat_tags_created_on_idx on chat_tags (created_on desc);
create index if not exists chat_tags_property_idx    on chat_tags (property);
alter table chat_tags enable row level security;

-- Per-hour summary (mirror of daily_counts, bucketed by hour 0-23).
create table if not exists hourly_counts (
  date         date not null,
  property_id  text not null,
  property     text not null,
  hour         integer not null,        -- 0-23 (report timezone)
  chat_volume  integer not null default 0,
  missed       integer not null default 0,
  offline      integer not null default 0,
  tickets      integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (date, property_id, hour)
);
create index if not exists hourly_counts_date_idx on hourly_counts (date);
alter table hourly_counts enable row level security;

-- Dashboard login accounts (admin / agent). Passwords are scrypt-hashed by the
-- app; the server validates the session token. Agent accounts are scoped to
-- their own chats via agent_name (must match the tawk display name exactly).
create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique,                              -- stored lowercased
  password_hash text not null,
  role          text not null default 'agent' check (role in ('admin','agent','hr')),
  agent_name    text,                                              -- exact tawk display name (agents)
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table app_users enable row level security;

-- Employee profile per account. HR/admin edit; agents view their own only.
create table if not exists employee_profiles (
  user_id            uuid primary key references app_users(id) on delete cascade,
  last_name          text,
  first_name         text,
  middle_name        text,
  signal_nickname    text,
  photo_url          text,
  mobile_number      text,
  carepack_email     text,
  getva_email        text,
  home_address       text,
  emergency_contact  text,
  employee_id        text,
  position           text,
  department         text,
  wisetags           text,
  updated_at         timestamptz not null default now(),
  updated_by         text
);
alter table employee_profiles enable row level security;

-- Lock everything down: only the service-role key (server) may access.
alter table chats              enable row level security;
alter table tickets            enable row level security;
alter table escalations        enable row level security;
alter table custom_attributes  enable row level security;
alter table daily_counts       enable row level security;
alter table chat_drivers_daily enable row level security;
alter table sync_state         enable row level security;
