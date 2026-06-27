import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/auth/agent-names — distinct agent display names seen in chat_tags,
// so the admin can map an agent account to the exact tawk name. Admin only.
export async function GET(req: NextRequest) {
  const g = await requireAdmin(req);
  if ("error" in g) return g.error;
  try {
    // Recent rows (PostgREST has no DISTINCT) — dedupe in JS.
    const { data, error } = await getSupabase()
      .from("chat_tags")
      .select("agent")
      .not("agent", "is", null)
      .order("created_on", { ascending: false })
      .limit(20000);
    if (error) throw new Error(error.message);
    const names = Array.from(
      new Set((data ?? []).map((r) => String((r as { agent: string | null }).agent ?? "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ names });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
