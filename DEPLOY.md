# Deploying to Vercel + Supabase

Architecture: **tawk.to → (daily sync) → Supabase → dashboard.** Reports and
escalation forms read/write Supabase; a daily job pulls tawk.to into Supabase and
refreshes the summary tables. This folder (`web/`) is the Next.js app and the root
of the `importdata` GitHub repo; Vercel deploys it on push to `main`.

## 1. Supabase (one-time)

1. Create a project (or use an existing one).
2. **SQL Editor → New query →** paste `web/supabase/schema.sql` → **Run**.
   Creates: `chats`, `tickets`, `escalations`, `custom_attributes`, `daily_counts`,
   `chat_drivers_daily`, `sync_state` (RLS on; service-role only).
3. Copy from **Project Settings → API Keys**: the **Project URL** and the
   **secret** key (`sb_secret_…`).

## 2. Vercel env vars

Settings → Environment Variables (Production + Preview):

| Var | Value |
|---|---|
| `TAWK_API_KEY` | your tawk.to REST API key |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | the `sb_secret_…` key |
| `CRON_SECRET` *(optional)* | long random string to lock `/api/sync` |

Root Directory stays default (`./`). Push to `main` to deploy.

## 3. Daily sync (cron inside Supabase)

After the app is deployed and you know its URL:

1. **SQL Editor →** paste `web/supabase/cron.sql`, replacing `<APP_URL>` and
   `<CRON_SECRET>` → **Run**. This uses `pg_cron` + `pg_net` to POST `/api/sync`
   once a day.
2. First load: click **“Sync now”** in the dashboard header to populate data
   immediately (no need to wait for the first cron run).

Inspect cron: `select * from cron.job;` and
`select * from net._http_response order by created desc limit 5;`

## Notes

- **Data freshness:** reports show data as of the last sync. The header shows the
  last-synced time; “Sync now” refreshes on demand.
- **Sync duration:** `/api/sync` walks every property (`maxDuration = 300`) — use a
  Vercel plan that allows long functions, or call `/api/sync?property=<id>` to
  split the load. `/api/sync?days=N` widens the window.
- **Auth:** the app has no built-in login. For anything sensitive, enable Vercel
  Authentication (password protect the deployment) and/or set `CRON_SECRET`.
- **Local dev:** with no Supabase env vars, the app falls back to live tawk.to
  reads + a local JSON file store, so it runs without a database.
