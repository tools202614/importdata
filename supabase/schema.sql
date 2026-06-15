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

-- Manual per-chat/ticket tags applied in the Chats list view. Keyed by the
-- conversation id; survives re-sync (the sync never writes this table).
create table if not exists chat_tags (
  id                        text primary key,
  type                      text not null,                 -- 'chat' | 'ticket'
  drivers                   jsonb not null default '[]'::jsonb,
  drivers_updated_at        timestamptz,
  channel_issue             jsonb not null default '[]'::jsonb,
  channel_issue_updated_at  timestamptz
);
alter table chat_tags enable row level security;

-- Lock everything down: only the service-role key (server) may access.
alter table chats              enable row level security;
alter table tickets            enable row level security;
alter table escalations        enable row level security;
alter table custom_attributes  enable row level security;
alter table daily_counts       enable row level security;
alter table chat_drivers_daily enable row level security;
alter table sync_state         enable row level security;
