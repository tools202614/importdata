import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { TEAMS, teamForProperty } from "@/lib/teams";
import { localDayUtcRange } from "@/lib/config";

export const dynamic = "force-dynamic";

const UNASSIGNED = "Unassigned";

interface PropRow { property: string; totalChats: number; pct: number }
interface IssueRow { issue: string; count: number; pct: number }
interface TeamBlock {
  name: string;
  title: string;
  properties: PropRow[];
  propertyTotal: number;
  issues: IssueRow[];
  issueTotal: number;
}

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0);

// GET /api/team-report?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 });
  }
  if (!SUPABASE_CONFIGURED) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  try {
    const sb = getSupabase();

    // 1) Chat volume per property from the daily summary table.
    const { data: dc, error: dcErr } = await sb
      .from("daily_counts")
      .select("property, chat_volume, day")
      .gte("day", from)
      .lte("day", to)
      .limit(100000);
    if (dcErr) throw new Error(`daily_counts: ${dcErr.message}`);

    const volumeByProperty = new Map<string, number>();
    for (const r of dc ?? []) {
      const p = String((r as { property: string }).property);
      const v = Number((r as { chat_volume: number }).chat_volume) || 0;
      volumeByProperty.set(p, (volumeByProperty.get(p) ?? 0) + v);
    }

    // 2) Common issues from per-chat Chat Drivers (chat_tags.drivers), grouped by
    //    team via the chat's property.
    const startUtc = localDayUtcRange(from).startUtc.toISOString();
    const endUtc = localDayUtcRange(to).endUtc.toISOString();

    // team name -> (issue -> count)
    const issuesByTeam = new Map<string, Map<string, number>>();
    const addIssue = (team: string, issue: string) => {
      if (!issuesByTeam.has(team)) issuesByTeam.set(team, new Map());
      const m = issuesByTeam.get(team)!;
      m.set(issue, (m.get(issue) ?? 0) + 1);
    };

    const size = 1000;
    let offset = 0;
    for (;;) {
      const { data: ct, error: ctErr } = await sb
        .from("chat_tags")
        .select("drivers, property")
        .gte("created_on", startUtc)
        .lte("created_on", endUtc)
        .range(offset, offset + size - 1);
      if (ctErr) throw new Error(`chat_tags: ${ctErr.message}`);
      const rows = (ct ?? []) as { drivers: string[] | null; property: string | null }[];
      for (const row of rows) {
        const drivers = (row.drivers ?? []).filter((d) => d && d.trim());
        if (!drivers.length) continue;
        const team = teamForProperty(String(row.property ?? "")) ?? UNASSIGNED;
        for (const d of drivers) addIssue(team, d);
      }
      if (rows.length < size) break;
      offset += size;
    }

    // 3) Assemble per-team blocks.
    const assignedProps = new Set(TEAMS.flatMap((t) => t.properties));

    const buildIssues = (team: string): { issues: IssueRow[]; issueTotal: number } => {
      const m = issuesByTeam.get(team) ?? new Map<string, number>();
      const issueTotal = Array.from(m.values()).reduce((s, n) => s + n, 0);
      const issues = Array.from(m.entries())
        .map(([issue, count]) => ({ issue, count, pct: pct(count, issueTotal) }))
        .sort((a, b) => b.count - a.count || a.issue.localeCompare(b.issue));
      return { issues, issueTotal };
    };

    const teams: TeamBlock[] = TEAMS.map((t) => {
      const props: PropRow[] = t.properties.map((property) => ({
        property,
        totalChats: volumeByProperty.get(property) ?? 0,
        pct: 0,
      }));
      const propertyTotal = props.reduce((s, p) => s + p.totalChats, 0);
      for (const p of props) p.pct = pct(p.totalChats, propertyTotal);
      props.sort((a, b) => b.totalChats - a.totalChats || a.property.localeCompare(b.property));
      const { issues, issueTotal } = buildIssues(t.name);
      return { name: t.name, title: t.title, properties: props, propertyTotal, issues, issueTotal };
    });

    // 4) Unassigned section (only if it has chats or issues) — never drop data silently.
    const unassignedProps: PropRow[] = [];
    for (const [property, totalChats] of volumeByProperty) {
      if (!assignedProps.has(property) && totalChats > 0) unassignedProps.push({ property, totalChats, pct: 0 });
    }
    const unTotal = unassignedProps.reduce((s, p) => s + p.totalChats, 0);
    for (const p of unassignedProps) p.pct = pct(p.totalChats, unTotal);
    unassignedProps.sort((a, b) => b.totalChats - a.totalChats || a.property.localeCompare(b.property));
    const { issues: unIssues, issueTotal: unIssueTotal } = buildIssues(UNASSIGNED);
    if (unassignedProps.length || unIssues.length) {
      teams.push({
        name: UNASSIGNED,
        title: "UNASSIGNED / OTHER",
        properties: unassignedProps,
        propertyTotal: unTotal,
        issues: unIssues,
        issueTotal: unIssueTotal,
      });
    }

    return NextResponse.json({ from, to, teams });
  } catch (err) {
    console.error("Team report error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
