import { NextRequest, NextResponse } from "next/server";
import { getChats, getTickets } from "@/lib/tawk-api";
import { PROPERTIES } from "@/lib/properties";

export const maxDuration = 300;

const emptyProp = () => ({ chat: 0, missed: 0, offline: 0, tickets: 0, thumbsUp: 0, thumbsDown: 0 });

interface PropertyBucket { chat: number; missed: number; offline: number; tickets: number; thumbsUp: number; thumbsDown: number }
interface HourBucket {
  totalChats: number; totalTickets: number; totalOffline: number; totalMissed: number;
  totalThumbsUp: number; totalThumbsDown: number;
  perProperty: Record<string, PropertyBucket>;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
  }

  try {
    const allHours: Record<string, HourBucket> = {};
    const start = new Date(startDate);
    const end = new Date(endDate);

    const current = new Date(start);
    current.setMinutes(0, 0, 0);
    while (current <= end) {
      allHours[current.toISOString()] = {
        totalChats: 0, totalTickets: 0, totalOffline: 0, totalMissed: 0,
        totalThumbsUp: 0, totalThumbsDown: 0, perProperty: {},
      };
      current.setHours(current.getHours() + 1);
    }

    for (const prop of PROPERTIES) {
      const [chats, tickets] = await Promise.all([
        getChats(prop.id, startDate, endDate),
        getTickets(prop.id, startDate, endDate),
      ]);

      for (const chat of chats) {
        if (!chat.createdOn) continue;
        const dt = new Date(chat.createdOn);
        dt.setMinutes(0, 0, 0);
        const key = dt.toISOString();
        if (!allHours[key]) continue;

        allHours[key].totalChats += 1;
        if (!allHours[key].perProperty[prop.id]) allHours[key].perProperty[prop.id] = emptyProp();
        const pd = allHours[key].perProperty[prop.id];
        pd.chat += 1;

        const rating = (chat as Record<string, unknown>).rating as number;
        if (rating === 5) { pd.thumbsUp += 1; allHours[key].totalThumbsUp += 1; }
        else if (rating === 1) { pd.thumbsDown += 1; allHours[key].totalThumbsDown += 1; }

        if ((chat as Record<string, unknown>).offlineForm) {
          pd.offline += 1; allHours[key].totalOffline += 1;
        } else if ((chat as Record<string, unknown>).status === "open") {
          pd.missed += 1; allHours[key].totalMissed += 1;
        }
      }

      for (const ticket of tickets) {
        if (!ticket.createdOn) continue;
        const dt = new Date(ticket.createdOn);
        dt.setMinutes(0, 0, 0);
        const key = dt.toISOString();
        if (!allHours[key]) continue;

        allHours[key].totalTickets += 1;
        if (!allHours[key].perProperty[prop.id]) allHours[key].perProperty[prop.id] = emptyProp();
        allHours[key].perProperty[prop.id].tickets += 1;
      }
    }

    const PH_OFFSET_MS = 8 * 60 * 60 * 1000;

    const rows = Object.entries(allHours)
      .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
      .map(([hourUtc, data]) => {
        const phTime = new Date(new Date(hourUtc).getTime() + PH_OFFSET_MS);
        const date = phTime.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "2-digit" });
        const hour = phTime.getHours();
        const ampm = hour >= 12 ? "PM" : "AM";
        const h12 = hour % 12 || 12;
        const time = `${h12}:00 ${ampm}`;

        const propertyData: Record<string, PropertyBucket> = {};
        for (const prop of PROPERTIES) {
          propertyData[prop.name] = data.perProperty[prop.id] || emptyProp();
        }

        return {
          date, time,
          totalChats: data.totalChats, totalTickets: data.totalTickets,
          totalOffline: data.totalOffline, totalMissed: data.totalMissed,
          totalThumbsUp: data.totalThumbsUp, totalThumbsDown: data.totalThumbsDown,
          properties: propertyData,
        };
      });

    return NextResponse.json({ rows, properties: PROPERTIES.map((p) => p.name) });
  } catch (err) {
    console.error("Hourly report error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
