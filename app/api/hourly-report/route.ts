import { NextRequest, NextResponse } from "next/server";
import { getChats } from "@/lib/tawk-api";
import { PROPERTIES } from "@/lib/properties";
import { dateKeyInTz } from "@/lib/config";

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

interface PropDayBucket {
  chats: number;
  durations: number[];
  frts: number[];
  missed: number;
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
  // FRT = time from chat creation to agent's first actual MESSAGE
  // (not the agent-join event, which fires immediately when the agent is
  // assigned but before they actually type anything).
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

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
  }

  try {
    // key = `${dateKey}|${propertyName}`
    const buckets: Record<string, PropDayBucket> = {};

    for (const prop of PROPERTIES) {
      const chats = (await getChats(prop.id, startDate, endDate)) as ChatItem[];

      for (const chat of chats) {
        if (!chat.createdOn) continue;
        const dateKey = dateKeyInTz(chat.createdOn);
        const key = `${dateKey}|${prop.name}`;
        if (!buckets[key]) {
          buckets[key] = { chats: 0, durations: [], frts: [], missed: 0 };
        }
        const b = buckets[key];

        // Total chat volume (every chat counts)
        b.chats += 1;

        // "Handled" = at least one real agent message (excludes agent-join events
        // where the agent was assigned but never actually responded)
        const hadAgent = (chat.messages || []).some((m) => m.sender?.t === "a" && m.type === "msg");

        if (hadAgent) {
          const dur = chatDurationSec(chat);
          if (dur !== null && dur > 0) b.durations.push(dur);

          const frt = firstResponseSec(chat);
          if (frt !== null) b.frts.push(frt);
        } else if (!chat.offlineForm) {
          // Missed: live chat where no agent responded
          b.missed += 1;
        }
      }
    }

    const rows = Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, b]) => {
        const [dateKey, property] = key.split("|");
        const phDate = new Date(`${dateKey}T00:00:00Z`);
        const date = phDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "2-digit", timeZone: "UTC" });
        const avgAHT = trimmedMean(b.durations);
        const avgFRT = medianOf(b.frts);
        return {
          date,
          dateKey,
          property,
          totalChats: b.chats,
          avgAHT: formatMS(avgAHT),
          avgFRT: formatMS(avgFRT),
          missedChats: b.missed,
        };
      });

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("Daily report error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
