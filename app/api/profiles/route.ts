import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireHrOrAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/profiles — every account with its employee profile (HR/admin only).
export async function GET(req: NextRequest) {
  const g = await requireHrOrAdmin(req);
  if ("error" in g) return g.error;
  try {
    const sb = getSupabase();
    const [{ data: users, error: uErr }, { data: profiles, error: pErr }] = await Promise.all([
      sb.from("app_users").select("id, username, role, agent_name, active").order("username"),
      sb.from("employee_profiles").select("*"),
    ]);
    if (uErr) throw new Error(uErr.message);
    if (pErr) throw new Error(pErr.message);

    const byId = new Map((profiles ?? []).map((p) => [(p as { user_id: string }).user_id, p]));
    const rows = (users ?? []).map((u) => ({ ...u, profile: byId.get((u as { id: string }).id) ?? null }));
    return NextResponse.json({ rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
