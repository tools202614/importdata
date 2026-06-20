import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { AUTH_CONFIGURED, hashPassword, createToken, setSessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/auth/setup  body: { username, password }
// First-run bootstrap: creates the initial admin, but ONLY while no users exist.
// After that it's locked (use the admin Accounts panel to add more).
export async function POST(req: NextRequest) {
  if (!AUTH_CONFIGURED) return NextResponse.json({ error: "Auth not configured (set AUTH_SECRET)" }, { status: 503 });
  if (!SUPABASE_CONFIGURED) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const { username, password } = (await req.json()) ?? {};
    const u = String(username ?? "").trim().toLowerCase();
    const p = String(password ?? "");
    if (u.length < 3) return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
    if (p.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });

    const sb = getSupabase();
    const { data: existing, error: exErr } = await sb.from("app_users").select("id").limit(1);
    if (exErr) return NextResponse.json({ error: `Run supabase/auth.sql first: ${exErr.message}` }, { status: 503 });
    if ((existing?.length ?? 0) > 0) return NextResponse.json({ error: "Setup already completed" }, { status: 403 });

    const { data, error } = await sb
      .from("app_users")
      .insert({ username: u, password_hash: hashPassword(p), role: "admin", active: true })
      .select("id, username, role, agent_name")
      .single();
    if (error) throw new Error(error.message);

    const session = { userId: data.id, username: data.username, role: "admin" as const, agentName: null };
    const res = NextResponse.json({ user: { username: data.username, role: "admin", agentName: null } });
    setSessionCookie(res, createToken(session));
    return res;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
