// ─────────────────────────────────────────────────────────────────────────
// Supabase server client.
//
// All access is server-side through API routes using the SECRET / service-role
// key (which bypasses RLS). The tables have RLS enabled with no public policies,
// so the publishable/anon key can't touch them. Never expose the secret key to
// the browser.
//
// If SUPABASE_URL / key are not set, SUPABASE_CONFIGURED is false and the app
// falls back to its pre-Supabase behavior (live tawk.to reads + local file store)
// so local dev works without a database.
// ─────────────────────────────────────────────────────────────────────────

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
// Accept either env name; both should hold the SECRET key (sb_secret_… / service_role).
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";

export const SUPABASE_CONFIGURED = !!(SUPABASE_URL && SUPABASE_KEY);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!SUPABASE_CONFIGURED) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the secret key)."
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
