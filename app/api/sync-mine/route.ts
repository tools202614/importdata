import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/sync";
import { SUPABASE_CONFIGURED } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/sync-mine — any signed-in user triggers a recent sync (last day).
// tawk's API is per-property, so this re-pulls recent data for all properties;
// the caller still only SEES their own rows (agents are scoped in chats-list).
export async function POST(req: NextRequest) {
  const g = await requireAuth(req);
  if ("error" in g) return g.error;
  if (!SUPABASE_CONFIGURED) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const result = await runSync({ days: 1 });
    return NextResponse.json({ ok: true, chats: result.chats, tickets: result.tickets, finishedAt: result.finishedAt });
  } catch (err) {
    console.error("sync-mine error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
