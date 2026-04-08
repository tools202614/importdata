import { NextRequest, NextResponse } from "next/server";
import { getChats } from "@/lib/tawk-api";
import { PROPERTIES } from "@/lib/properties";

export const maxDuration = 300;

interface ChatItem {
  createdOn?: string;
  offlineForm?: unknown;
  agent?: { name?: string };
  agentName?: string;
  messages?: { sender?: { t?: string; n?: string } }[];
  chatDuration?: number;
  duration?: number;
  endedOn?: string;
  endTime?: string;
  startTime?: string;
  rating?: number;
  [key: string]: unknown;
}

function getAgentName(chat: ChatItem): string {
  if (chat.agent && typeof chat.agent === "object" && chat.agent.name) return chat.agent.name;
  if (chat.agentName) return chat.agentName;
  for (const msg of chat.messages || []) {
    if (msg.sender?.t === "a" && msg.sender?.n) return msg.sender.n;
  }
  return "Unknown";
}

function getChatDuration(chat: ChatItem): number {
  if (chat.chatDuration != null) return Number(chat.chatDuration);
  if (chat.duration != null) return Number(chat.duration);
  const startStr = chat.createdOn || chat.startTime;
  const endStr = chat.endedOn || chat.endTime;
  if (startStr && endStr) {
    const diff = (new Date(endStr).getTime() - new Date(startStr).getTime()) / 1000;
    return Math.max(0, diff);
  }
  return 0;
}

function formatDuration(totalSeconds: number): string {
  totalSeconds = Math.floor(totalSeconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface Bucket { totalSeconds: number; chatCount: number; thumbsUp: number; thumbsDown: number }

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
  }

  try {
    const detail: Record<string, Bucket> = {};

    for (const prop of PROPERTIES) {
      const chats = (await getChats(prop.id, startDate, endDate)) as ChatItem[];

      for (const chat of chats) {
        if (chat.offlineForm) continue;
        if (!chat.createdOn) continue;

        const dateStr = new Date(chat.createdOn).toISOString().split("T")[0];
        const agent = getAgentName(chat);
        const duration = getChatDuration(chat);
        const rating = chat.rating || 0;

        const key = `${dateStr}|${agent}|${prop.name}`;
        if (!detail[key]) detail[key] = { totalSeconds: 0, chatCount: 0, thumbsUp: 0, thumbsDown: 0 };
        detail[key].totalSeconds += duration;
        detail[key].chatCount += 1;
        // Tawk API: 0 = no rating, 1 = thumbs up (positive), 2 = thumbs down (negative)
        if (rating === 1) detail[key].thumbsUp += 1;
        else if (rating === 2) detail[key].thumbsDown += 1;
      }
    }

    const aggregated: Record<string, Bucket> = {};
    for (const [key, data] of Object.entries(detail)) {
      const [dateStr, agent] = key.split("|");
      const aggKey = `${dateStr}|${agent}`;
      if (!aggregated[aggKey]) aggregated[aggKey] = { totalSeconds: 0, chatCount: 0, thumbsUp: 0, thumbsDown: 0 };
      aggregated[aggKey].totalSeconds += data.totalSeconds;
      aggregated[aggKey].chatCount += data.chatCount;
      aggregated[aggKey].thumbsUp += data.thumbsUp;
      aggregated[aggKey].thumbsDown += data.thumbsDown;
    }

    const summaryRows = Object.entries(aggregated)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, data]) => {
        const [date, agent] = key.split("|");
        return {
          date, agent,
          duration: formatDuration(data.totalSeconds),
          chatCount: data.chatCount,
          thumbsUp: data.thumbsUp, thumbsDown: data.thumbsDown,
        };
      });

    const detailRows = Object.entries(detail)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, data]) => {
        const [date, agent, property] = key.split("|");
        return {
          date, agent, property,
          duration: formatDuration(data.totalSeconds),
          chatCount: data.chatCount,
          thumbsUp: data.thumbsUp, thumbsDown: data.thumbsDown,
        };
      });

    const grandTotalSeconds = Object.values(detail).reduce((s, d) => s + d.totalSeconds, 0);
    const grandTotalChats = Object.values(detail).reduce((s, d) => s + d.chatCount, 0);
    const grandThumbsUp = Object.values(detail).reduce((s, d) => s + d.thumbsUp, 0);
    const grandThumbsDown = Object.values(detail).reduce((s, d) => s + d.thumbsDown, 0);

    return NextResponse.json({
      summary: summaryRows,
      detail: detailRows,
      grandTotal: {
        duration: formatDuration(grandTotalSeconds),
        chatCount: grandTotalChats,
        thumbsUp: grandThumbsUp, thumbsDown: grandThumbsDown,
      },
    });
  } catch (err) {
    console.error("Agent duration error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
