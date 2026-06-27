import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface TagRow {
  id: string;
  type: "chat" | "ticket";
  property: string | null;
  property_id: string | null;
  channel_user: string | null;
  email: string | null;
  phone: string | null;
  agent: string | null;
  created_on: string | null;
  last_seen: string | null;
  drivers: string[] | null;
  drivers_updated_at: string | null;
  channel_issue: string[] | null;
  channel_issue_updated_at: string | null;
}

const s = (v: unknown) => (v == null ? "" : String(v));

// GET /api/chats-list?startDate=&endDate=&type=&property=&q=
// Reads the unified chat_tags table (seeded by sync + realtime webhooks).
export async function GET(req: NextRequest) {
  const g = await requireAuth(req);
  if ("error" in g) return g.error;
  const { session } = g;
  if (!SUPABASE_CONFIGURED) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  // Agents are scoped to their own conversations server-side (not just by hiding UI).
  // Matched case-insensitively and whitespace-trimmed so minor name differences
  // don't hide an agent's data.
  const scopeAgent = session.role === "agent" ? (session.agentName ?? "").trim().toLowerCase() : null;
  if (session.role === "agent" && !scopeAgent) return NextResponse.json({ rows: [] });
  const sp = req.nextUrl.searchParams;
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const type = sp.get("type");
  const property = sp.get("property");
  const q = sp.get("q")?.trim().toLowerCase();
  if (!startDate || !endDate) return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 });

  try {
    const sb = getSupabase();
    const out: TagRow[] = [];
    const size = 1000;
    let from = 0;
    for (;;) {
      let query = sb
        .from("chat_tags")
        .select("*")
        .gte("created_on", startDate)
        .lte("created_on", endDate)
        .order("created_on", { ascending: false })
        .range(from, from + size - 1);
      if (type === "chat" || type === "ticket") query = query.eq("type", type);
      if (property) query = query.eq("property", property);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as TagRow[];
      out.push(...rows);
      if (rows.length < size) break;
      from += size;
    }

    let rows = out.map((r) => ({
      id: r.id,
      type: r.type,
      property: s(r.property),
      propertyId: s(r.property_id),
      channelUser: s(r.channel_user),
      email: s(r.email),
      phone: s(r.phone),
      createdOn: s(r.created_on),
      lastSeen: s(r.last_seen),
      agent: s(r.agent),
      drivers: r.drivers ?? [],
      driversUpdatedAt: r.drivers_updated_at,
      channelIssue: r.channel_issue ?? [],
      channelIssueUpdatedAt: r.channel_issue_updated_at,
    }));

    // Enforce agent scope on normalized names (handles casing / stray whitespace
    // in stored data without needing a re-sync).
    if (scopeAgent) {
      rows = rows.filter((r) => r.agent.trim().toLowerCase() === scopeAgent);
    }

    if (q) {
      rows = rows.filter((r) => [r.channelUser, r.email, r.phone, r.agent].some((v) => v.toLowerCase().includes(q)));
    }

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("chats-list error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
