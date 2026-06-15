import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Raw = Record<string, unknown>;
interface DbRow { id: string; property: string; property_id: string; raw: Raw }
interface TagRow {
  id: string;
  drivers: string[];
  drivers_updated_at: string | null;
  channel_issue: string[];
  channel_issue_updated_at: string | null;
}

const str = (v: unknown) => (v == null ? "" : String(v));

function agentName(raw: Raw): string {
  const a = raw.agent as { name?: string } | undefined;
  if (a?.name) return a.name;
  if (raw.agentName) return str(raw.agentName);
  for (const m of (raw.messages as { sender?: { t?: string; n?: string } }[] | undefined) || []) {
    if (m.sender?.t === "a" && m.sender?.n) return m.sender.n;
  }
  return "";
}

async function pageAll(table: "chats" | "tickets", startDate: string, endDate: string, property: string | null): Promise<DbRow[]> {
  const sb = getSupabase();
  const out: DbRow[] = [];
  const size = 1000;
  let from = 0;
  for (;;) {
    let q = sb
      .from(table)
      .select("id, property, property_id, raw")
      .gte("created_on", startDate)
      .lte("created_on", endDate)
      .order("created_on", { ascending: false })
      .range(from, from + size - 1);
    if (property) q = q.eq("property", property);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as DbRow[];
    out.push(...rows);
    if (rows.length < size) break;
    from += size;
  }
  return out;
}

export async function GET(req: NextRequest) {
  if (!SUPABASE_CONFIGURED) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const sp = req.nextUrl.searchParams;
  const startDate = sp.get("startDate");
  const endDate = sp.get("endDate");
  const type = sp.get("type"); // 'chat' | 'ticket' | null(all)
  const property = sp.get("property");
  const q = sp.get("q")?.trim().toLowerCase();
  if (!startDate || !endDate) return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 });

  try {
    const sb = getSupabase();
    const chats = type === "ticket" ? [] : await pageAll("chats", startDate, endDate, property);
    const tickets = type === "chat" ? [] : await pageAll("tickets", startDate, endDate, property);

    const rows = [
      ...chats.map((r) => {
        const raw = r.raw || {};
        const visitor = (raw.visitor as { name?: string; email?: string; phone?: string }) || {};
        return {
          id: r.id, type: "chat" as const, property: r.property, propertyId: r.property_id,
          channelUser: str(visitor.name), email: str(visitor.email), phone: str(visitor.phone),
          createdOn: str(raw.createdOn), lastSeen: str(raw.updatedOn), agent: agentName(raw),
        };
      }),
      ...tickets.map((r) => {
        const raw = r.raw || {};
        const requester = (raw.requester as { name?: string; email?: string; phone?: string }) || {};
        const assignee = (raw.assignee as { name?: string }) || {};
        return {
          id: r.id, type: "ticket" as const, property: r.property, propertyId: r.property_id,
          channelUser: str(requester.name), email: str(requester.email), phone: str(requester.phone),
          createdOn: str(raw.createdOn), lastSeen: str(raw.updatedOn), agent: str(assignee.name),
        };
      }),
    ];

    // Join tags
    const ids = rows.map((r) => r.id);
    const tagsById = new Map<string, TagRow>();
    for (let i = 0; i < ids.length; i += 1000) {
      const batch = ids.slice(i, i + 1000);
      if (!batch.length) break;
      const { data, error } = await sb.from("chat_tags").select("*").in("id", batch);
      if (error) throw new Error(`chat_tags: ${error.message}`);
      for (const t of (data ?? []) as TagRow[]) tagsById.set(t.id, t);
    }

    let merged = rows.map((r) => {
      const t = tagsById.get(r.id);
      return {
        ...r,
        drivers: t?.drivers ?? [],
        driversUpdatedAt: t?.drivers_updated_at ?? null,
        channelIssue: t?.channel_issue ?? [],
        channelIssueUpdatedAt: t?.channel_issue_updated_at ?? null,
      };
    });

    if (q) {
      merged = merged.filter((r) =>
        [r.channelUser, r.email, r.phone, r.agent].some((v) => v.toLowerCase().includes(q))
      );
    }
    merged.sort((a, b) => b.createdOn.localeCompare(a.createdOn));

    return NextResponse.json({ rows: merged });
  } catch (err) {
    console.error("chats-list error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
