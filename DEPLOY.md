# Deploying to Vercel

This folder (`web/`) **is** the Next.js app and the root of the `importdata` GitHub
repo. Vercel deploys it automatically on push to `main`.

## One-time setup (Vercel dashboard)

1. **Root Directory** — Project → Settings → leave as default (`./`). The repo root
   already is the Next.js app (do *not* set it to `web`).

2. **Postgres (required for the Escalations forms)** — Storage → Create → Postgres
   (Neon) → connect to this project. This auto-adds `POSTGRES_URL`. The `escalations`
   table is created automatically on first save.

3. **Environment Variables** — Settings → Environment Variables → add for
   Production + Preview:
   - `TAWK_API_KEY` = your tawk.to REST API key (required by every reporting tab).
   - `POSTGRES_URL` is set automatically by step 2 (or paste a Neon/`DATABASE_URL`).

4. If you add the storage/env **after** the first deploy, trigger a redeploy so the
   functions pick up the new variables.

## Deploy

```bash
git push origin main      # Vercel builds & deploys automatically
```

## Notes

- **Storage:** on Vercel, escalation records persist in Postgres. Locally (no
  `POSTGRES_URL`) they fall back to a JSON file in `web/data/` (gitignored) — so
  local dev needs no database.
- **Function duration:** the reporting routes set `maxDuration = 300`; that needs a
  plan that allows long functions (Pro). The UI already fetches one day per request
  to stay within limits.
- **Secrets:** `.env*` is gitignored — never commit your real API key.
