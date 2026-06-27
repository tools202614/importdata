import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/sync-state — last sync time + summary, for the UI freshness indicator.
export async function GET(req: NextRequest) {
  const g = await requireAuth(req);
  if ("error" in g) return g.error;
  if (!SUPABASE_CONFIGURED) {
    return NextResponse.json({ configured: false, lastSyncedAt: null, detail: null });
  }
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from("sync_state").select("*").eq("id", "tawk").maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({
      configured: true,
      lastSyncedAt: data?.last_synced_at ?? null,
      detail: data?.detail ?? null,
    });
  } catch (err) {
    return NextResponse.json({ configured: true, error: String(err) }, { status: 500 });
  }
}
