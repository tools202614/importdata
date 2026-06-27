import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { localDayUtcRange } from "@/lib/config";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0);

// GET /api/chat-driver-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&property=
// Read-only counts of chat drivers, from the per-chat tags (chat_tags.drivers).
export async function GET(req: NextRequest) {
  const g = await requireAdmin(req);
  if ("error" in g) return g.error;
  if (!SUPABASE_CONFIGURED) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const property = req.nextUrl.searchParams.get("property");
  if (!from || !to) return NextResponse.json({ error: "from and to (YYYY-MM-DD) required" }, { status: 400 });

  try {
    const sb = getSupabase();
    const startUtc = localDayUtcRange(from).startUtc.toISOString();
    const endUtc = localDayUtcRange(to).endUtc.toISOString();

    const counts = new Map<string, number>();
    let taggedConversations = 0;
    const size = 1000;
    let offset = 0;
    for (;;) {
      let q = sb
        .from("chat_tags")
        .select("drivers, property, created_on")
        .gte("created_on", startUtc)
        .lte("created_on", endUtc)
        .range(offset, offset + size - 1);
      if (property) q = q.eq("property", property);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { drivers: string[] | null }[];
      for (const r of rows) {
        const drivers = (r.drivers ?? []).filter((d) => d && d.trim());
        if (drivers.length) taggedConversations += 1;
        for (const d of drivers) counts.set(d, (counts.get(d) ?? 0) + 1);
      }
      if (rows.length < size) break;
      offset += size;
    }

    const total = Array.from(counts.values()).reduce((s, n) => s + n, 0);
    const rows = Array.from(counts.entries())
      .map(([driver, count]) => ({ driver, count, pct: pct(count, total) }))
      .sort((a, b) => b.count - a.count || a.driver.localeCompare(b.driver));

    return NextResponse.json({ rows, total, taggedConversations });
  } catch (err) {
    console.error("chat-driver-summary error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
