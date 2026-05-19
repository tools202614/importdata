import { NextRequest, NextResponse } from "next/server";
import { getChats, getTickets } from "@/lib/tawk-api";
import { PROPERTIES } from "@/lib/properties";

export const maxDuration = 300;

const emptyProp = () => ({ chat: 0, missed: 0, offline: 0, tickets: 0, thumbsUp: 0, thumbsDown: 0 });

interface PropertyBucket { chat: number; missed: number; offline: number; tickets: number; thumbsUp: number; thumbsDown: number }
interface DayBucket {
  totalChats: number; totalTickets: number; totalOffline: number; totalMissed: number;
  totalThumbsUp: number; totalThumbsDown: number;
  perProperty: Record<string, PropertyBucket>;
}

const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

function phDateKey(iso: string): string {
  const phTime = new Date(new Date(iso).getTime() + PH_OFFSET_MS);
  return phTime.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
  }

  try {
    const allDays: Record<string, DayBucket> = {};

    // Pre-create day buckets in PH time
    const startKey = phDateKey(startDate);
    const endKey = phDateKey(endDate);
    const cursor = new Date(`${startKey}T00:00:00Z`);
    const lastDay = new Date(`${endKey}T00:00:00Z`);
    while (cursor <= lastDay) {
      const dayKey = cursor.toISOString().split("T")[0];
      allDays[dayKey] = {
        totalChats: 0, totalTickets: 0, totalOffline: 0, totalMissed: 0,
        totalThumbsUp: 0, totalThumbsDown: 0, perProperty: {},
      };
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    for (const prop of PROPERTIES) {
      const [chats, tickets] = await Promise.all([
        getChats(prop.id, startDate, endDate),
        getTickets(prop.id, startDate, endDate),
      ]);

      for (const chat of chats) {
        if (!chat.createdOn) continue;
        const key = phDateKey(chat.createdOn as string);
        if (!allDays[key]) continue;

        allDays[key].totalChats += 1;
        if (!allDays[key].perProperty[prop.id]) allDays[key].perProperty[prop.id] = emptyProp();
        const pd = allDays[key].perProperty[prop.id];
        pd.chat += 1;

        const rating = (chat as Record<string, unknown>).rating as number;
        // Tawk API: 0 = no rating, 1 = thumbs up (positive), -1 = thumbs down (negative)
        if (rating === 1) { pd.thumbsUp += 1; allDays[key].totalThumbsUp += 1; }
        else if (rating === -1) { pd.thumbsDown += 1; allDays[key].totalThumbsDown += 1; }

        if ((chat as Record<string, unknown>).offlineForm) {
          pd.offline += 1; allDays[key].totalOffline += 1;
        } else if ((chat as Record<string, unknown>).status === "open") {
          pd.missed += 1; allDays[key].totalMissed += 1;
        }
      }

      for (const ticket of tickets) {
        if (!ticket.createdOn) continue;
        const key = phDateKey(ticket.createdOn as string);
        if (!allDays[key]) continue;

        allDays[key].totalTickets += 1;
        if (!allDays[key].perProperty[prop.id]) allDays[key].perProperty[prop.id] = emptyProp();
        allDays[key].perProperty[prop.id].tickets += 1;
      }
    }

    const rows = Object.entries(allDays)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, data]) => {
        const phDate = new Date(`${dayKey}T00:00:00Z`);
        const date = phDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "2-digit", timeZone: "UTC" });

        const propertyData: Record<string, PropertyBucket> = {};
        for (const prop of PROPERTIES) {
          propertyData[prop.name] = data.perProperty[prop.id] || emptyProp();
        }

        return {
          date,
          totalChats: data.totalChats, totalTickets: data.totalTickets,
          totalOffline: data.totalOffline, totalMissed: data.totalMissed,
          totalThumbsUp: data.totalThumbsUp, totalThumbsDown: data.totalThumbsDown,
          properties: propertyData,
        };
      });

    return NextResponse.json({ rows, properties: PROPERTIES.map((p) => p.name) });
  } catch (err) {
    console.error("Daily report error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
