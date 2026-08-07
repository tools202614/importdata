-- ─────────────────────────────────────────────────────────────────────────
-- Escalation ownership migration. Run ONCE in the Supabase SQL Editor.
--
-- Records who created each escalation (chargeback/refund) so agents see only
-- their own while admins see everyone's. Existing rows get NULL owner (they show
-- to admins only). The NOTIFY refreshes PostgREST's schema cache.
-- ─────────────────────────────────────────────────────────────────────────

alter table escalations add column if not exists created_by text;   -- account username
alter table escalations add column if not exists agent_name text;    -- creator's display/agent name

create index if not exists escalations_created_by_idx on escalations (created_by);

notify pgrst, 'reload schema';
