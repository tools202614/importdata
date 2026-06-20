import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { CHANNEL_ISSUE_SET, CHAT_DRIVER_SET } from "@/lib/chat-tags";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// PATCH /api/chat-tags  body: { id, type, drivers?: string[], channelIssue?: string[] }
// Only the provided dimension(s) are updated, each with its own updated_at.
export async function PATCH(req: NextRequest) {
  const g = requireAuth(req);
  if ("error" in g) return g.error;
  const { session } = g;
  if (!SUPABASE_CONFIGURED) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const body = await req.json();
    const { id, type, drivers, channelIssue } = body ?? {};
    if (!id || typeof id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 });
    if (type !== "chat" && type !== "ticket") return NextResponse.json({ error: "type must be chat|ticket" }, { status: 400 });

    // Agents may only tag their own conversations.
    if (session.role === "agent") {
      if (!session.agentName) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const { data: owner } = await getSupabase().from("chat_tags").select("agent").eq("id", id).maybeSingle();
      if (!owner || owner.agent !== session.agentName) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date().toISOString();
    const row: Record<string, unknown> = { id, type };

    if (Array.isArray(drivers)) {
      const bad = drivers.filter((d: string) => !CHAT_DRIVER_SET.has(d));
      if (bad.length) return NextResponse.json({ error: `Invalid driver(s): ${bad.join(", ")}` }, { status: 400 });
      row.drivers = drivers;
      row.drivers_updated_at = now;
    }
    if (Array.isArray(channelIssue)) {
      const bad = channelIssue.filter((c: string) => !CHANNEL_ISSUE_SET.has(c));
      if (bad.length) return NextResponse.json({ error: `Invalid channel issue(s): ${bad.join(", ")}` }, { status: 400 });
      row.channel_issue = channelIssue;
      row.channel_issue_updated_at = now;
    }
    if (!("drivers" in row) && !("channel_issue" in row)) {
      return NextResponse.json({ error: "Provide drivers and/or channelIssue" }, { status: 400 });
    }

    const sb = getSupabase();
    const { data, error } = await sb.from("chat_tags").upsert(row, { onConflict: "id" }).select("*").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ tag: data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
