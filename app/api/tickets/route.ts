import { NextRequest, NextResponse } from "next/server";
import { getTickets } from "@/lib/data-source";
import { PROPERTIES } from "@/lib/properties";
import { dateKeyInTz } from "@/lib/config";
import { requireAdmin } from "@/lib/auth";

export const maxDuration = 300;

interface TicketItem {
  createdOn?: string;
  subject?: string;
  status?: string;
  priority?: string;
  source?: string;
  tags?: string[];
  requester?: { name?: string; email?: string };
  assignee?: { name?: string };
  humanId?: number;
  [key: string]: unknown;
}

export async function GET(req: NextRequest) {
  const g = await requireAdmin(req);
  if ("error" in g) return g.error;
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
  }

  try {
    const rows: Record<string, unknown>[] = [];

    for (const prop of PROPERTIES) {
      const tickets = (await getTickets(prop.id, startDate, endDate)) as TicketItem[];
      for (const t of tickets) {
        if (!t.createdOn) continue;
        const tags = t.tags || [];
        rows.push({
          dateKey: dateKeyInTz(t.createdOn),
          createdOn: t.createdOn,
          property: prop.name,
          ticketId: t.humanId ?? null,
          channelUser: t.requester?.name || t.requester?.email || "",
          subject: t.subject || "",
          status: t.status || "",
          priority: t.priority || "",
          source: t.source || "",
          assignee: t.assignee?.name || "",
          tag1: tags[0] || "",
          tag2: tags[1] || "",
          allTags: tags,
        });
      }
    }

    // Newest first
    rows.sort((a, b) => String(b.createdOn).localeCompare(String(a.createdOn)));

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("Tickets report error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
