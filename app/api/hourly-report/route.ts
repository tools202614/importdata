import { NextRequest, NextResponse } from "next/server";
import { getChats } from "@/lib/tawk-api";
import { PROPERTIES } from "@/lib/properties";
import { TZ_OFFSET_MS } from "@/lib/config";

export const maxDuration = 300;

interface ChatItem {
  createdOn?: string;
  status?: string;
  offlineForm?: unknown;
  chatDuration?: number;
  duration?: number;
  endedOn?: string;
  messages?: { sender?: { t?: string }; time?: string }[];
  rating?: number;
  [key: string]: unknown;
}

interface PropDayBucket {
  chats: number;
  totalDurationSec: number;
  durationCount: number;
  totalFrtSec: number;
  frtCount: number;
  missed: number;
}

function phDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + TZ_OFFSET_MS).toISOString().split("T")[0];
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
  // FRT = time from chat creation (queue/assignment) to first agent message.
  // Matches Tawk dashboard's "First Response Time" metric.
  if (!c.createdOn) return null;
  const createdMs = new Date(c.createdOn).getTime();
  for (const m of c.messages || []) {
    if (m.sender?.t === "a" && m.time) {
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
        const dateKey = phDateKey(chat.createdOn);
        const key = `${dateKey}|${prop.name}`;
        if (!buckets[key]) {
          buckets[key] = { chats: 0, totalDurationSec: 0, durationCount: 0, totalFrtSec: 0, frtCount: 0, missed: 0 };
        }
        const b = buckets[key];

        const hadAgent = (chat.messages || []).some((m) => m.sender?.t === "a");

        if (hadAgent) {
          // Handled: an agent actually participated in this chat
          b.chats += 1;

          const dur = chatDurationSec(chat);
          if (dur !== null && dur > 0) {
            b.totalDurationSec += dur;
            b.durationCount += 1;
          }

          const frt = firstResponseSec(chat);
          if (frt !== null) {
            b.totalFrtSec += frt;
            b.frtCount += 1;
          }
        } else if (!chat.offlineForm) {
          // Missed: live chat where no agent responded (offline form submissions don't count)
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
        const avgAHT = b.durationCount > 0 ? b.totalDurationSec / b.durationCount : 0;
        const avgFRT = b.frtCount > 0 ? b.totalFrtSec / b.frtCount : 0;
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
