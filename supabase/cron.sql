-- ─────────────────────────────────────────────────────────────────────────
-- Daily sync trigger, living inside Supabase (pg_cron + pg_net).
--
-- Once a day Supabase calls the deployed /api/sync endpoint, which pulls tawk.to
-- data into Supabase and refreshes the daily summary tables. Run this AFTER
-- schema.sql, and after you know your deployed app URL.
--
-- Before running, replace:
--   <APP_URL>      e.g. https://your-app.vercel.app   (no trailing slash)
--   <CRON_SECRET>  any long random string; also set CRON_SECRET in Vercel env
--                  (omit the Authorization header + the env var to leave it open)
-- ─────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove a previous schedule with the same name (safe to run repeatedly).
select cron.unschedule('tawk-daily-sync')
where exists (select 1 from cron.job where jobname = 'tawk-daily-sync');

-- Daily at 07:00 UTC. Adjust the cron expression as needed.
select cron.schedule(
  'tawk-daily-sync',
  '0 7 * * *',
  $$
  select net.http_post(
    url     := '<APP_URL>/api/sync',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer <CRON_SECRET>'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 280000
  );
  $$
);

-- Inspect:   select * from cron.job;
-- History:   select * from cron.job_run_details order by start_time desc limit 10;
-- Responses: select * from net._http_response order by created desc limit 10;
