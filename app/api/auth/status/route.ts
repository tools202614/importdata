import { NextResponse } from "next/server";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { AUTH_CONFIGURED } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/auth/status — public. Tells the login UI which state to render:
// configured? table migrated? first-run (no users yet)?
export async function GET() {
  const base = { authConfigured: AUTH_CONFIGURED, supabaseConfigured: SUPABASE_CONFIGURED };
  if (!AUTH_CONFIGURED || !SUPABASE_CONFIGURED) {
    return NextResponse.json({ ...base, tableReady: false, needsSetup: false });
  }
  try {
    // Real select (not head+count) — a missing table otherwise returns a false success.
    const { data, error } = await getSupabase().from("app_users").select("id").limit(1);
    if (error) return NextResponse.json({ ...base, tableReady: false, needsSetup: false, hint: error.message });
    return NextResponse.json({ ...base, tableReady: true, needsSetup: (data?.length ?? 0) === 0 });
  } catch (err) {
    return NextResponse.json({ ...base, tableReady: false, needsSetup: false, hint: String(err) });
  }
}
