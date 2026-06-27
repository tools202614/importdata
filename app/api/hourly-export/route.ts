import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/hourly-export?from=YYYY-MM-DD&to=YYYY-MM-DD&property=
// Per-hour rows from hourly_counts for download.
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
    const out: Record<string, unknown>[] = [];
    const size = 1000;
    let offset = 0;
    for (;;) {
      let q = sb
        .from("hourly_counts")
        .select("date, property, hour, chat_volume, missed, offline, tickets")
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: true })
        .order("property", { ascending: true })
        .order("hour", { ascending: true })
        .range(offset, offset + size - 1);
      if (property) q = q.eq("property", property);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      out.push(...rows);
      if (rows.length < size) break;
      offset += size;
    }
    return NextResponse.json({ rows: out });
  } catch (err) {
    console.error("hourly-export error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
