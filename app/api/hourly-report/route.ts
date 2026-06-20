import { NextRequest, NextResponse } from "next/server";
import { getChats, getTickets } from "@/lib/data-source";
import { PROPERTIES } from "@/lib/properties";
import { dateKeyInTz, hourInTz } from "@/lib/config";
import { requireAdmin } from "@/lib/auth";

export const maxDuration = 300;

interface ChatItem {
  createdOn?: string;
  status?: string;
  offlineForm?: unknown;
  chatDuration?: number;
  duration?: number;
  endedOn?: string;
  messages?: { sender?: { t?: string }; time?: string; type?: string }[];
  rating?: number;
  [key: string]: unknown;
}

interface TicketItem {
  createdOn?: string;
  [key: string]: unknown;
}

interface HourBucket { chats: number; tickets: number }

interface PropDayBucket {
  chats: number;
  tickets: number;
  durations: number[];
  frts: number[];
  missed: number;
  hourly: HourBucket[];
}

function emptyHourly(): HourBucket[] {
  return Array.from({ length: 24 }, () => ({ chats: 0, tickets: 0 }));
}

// AHT: trimmed mean (drop top 10% outliers) — matches Tawk's reported avg.
function trimmedMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.max(1, Math.floor(sorted.length / 10));
  const kept = sorted.length > trim ? sorted.slice(0, sorted.length - trim) : sorted;
  return kept.reduce((s, v) => s + v, 0) / kept.length;
}

// FRT: median — matches Tawk's reported avg (resistant to outliers).
function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function chatDurationSec(c: ChatItem): number | null {
  if (typeof c.chatDuration === "number") return c.chatDuration;
  if (typeof c.duration === "number") return c.duration;
  if (c.createdOn && c.endedOn) {
    return Math.max(0, (new Date(c.endedOn).getTime() - new Date(c.createdOn).getTime()) / 1000);
  }
  return null;
}

function firstResponseSec(c: ChatItem): number | null {
  if (!c.createdOn) return null;
  const createdMs = new Date(c.createdOn).getTime();
  for (const m of c.messages || []) {
    if (m.sender?.t === "a" && m.type === "msg" && m.time) {
      const agentMs = new Date(m.time).getTime();
      if (agentMs >= createdMs) return (agentMs - createdMs) / 1000;
    }
  }
  return null;
}

function formatMS(seconds: number): string {
  if (seconds <= 0) return "0";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function ensureBucket(buckets: Record<string, PropDayBucket>, key: string): PropDayBucket {
  if (!buckets[key]) {
    buckets[key] = { chats: 0, tickets: 0, durations: [], frts: [], missed: 0, hourly: emptyHourly() };
  }
  return buckets[key];
}

export async function GET(req: NextRequest) {
  const g = requireAdmin(req);
  if ("error" in g) return g.error;
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
  }

  try {
    const buckets: Record<string, PropDayBucket> = {};

    for (const prop of PROPERTIES) {
      const [chats, tickets] = await Promise.all([
        getChats(prop.id, startDate, endDate) as Promise<ChatItem[]>,
        getTickets(prop.id, startDate, endDate) as Promise<TicketItem[]>,
      ]);

      for (const chat of chats) {
        if (!chat.createdOn) continue;
        const dateKey = dateKeyInTz(chat.createdOn);
        const hour = hourInTz(chat.createdOn);
        const b = ensureBucket(buckets, `${dateKey}|${prop.name}`);

        b.chats += 1;
        b.hourly[hour].chats += 1;

        const hadAgent = (chat.messages || []).some((m) => m.sender?.t === "a" && m.type === "msg");
        if (hadAgent) {
          const dur = chatDurationSec(chat);
          if (dur !== null && dur > 0) b.durations.push(dur);
          const frt = firstResponseSec(chat);
          if (frt !== null) b.frts.push(frt);
        } else if (!chat.offlineForm) {
          b.missed += 1;
        }
      }

      for (const ticket of tickets) {
        if (!ticket.createdOn) continue;
        const dateKey = dateKeyInTz(ticket.createdOn);
        const hour = hourInTz(ticket.createdOn);
        const b = ensureBucket(buckets, `${dateKey}|${prop.name}`);
        b.tickets += 1;
        b.hourly[hour].tickets += 1;
      }
    }

    const rows = Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, b]) => {
        const [dateKey, property] = key.split("|");
        const dateObj = new Date(`${dateKey}T00:00:00Z`);
        const date = dateObj.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "2-digit", timeZone: "UTC" });
        return {
          date,
          dateKey,
          property,
          totalChats: b.chats,
          totalTickets: b.tickets,
          avgAHT: formatMS(trimmedMean(b.durations)),
          avgFRT: formatMS(medianOf(b.frts)),
          missedChats: b.missed,
          hourly: b.hourly,
        };
      });

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("Daily report error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
