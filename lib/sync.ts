// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sync job: tawk.to â†’ Supabase.
//
// For a recent window it pulls chats & tickets for every property, upserts the
// raw objects, recomputes the daily summary tables (daily_counts +
// chat_drivers_daily) for the covered days, refreshes custom attributes, and
// stamps sync_state. Re-run daily with a small overlap so each day gets a full
// recount the day after (statuses settle, late items get picked up).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { getSupabase } from "./supabase";
import { PROPERTIES } from "./properties";
import { dateKeyInTz, hourInTz, localDayUtcRange } from "./config";
import { UNTAGGED } from "./drivers";
import * as live from "./tawk-api";

interface Chat {
  id?: string;
  createdOn?: string;
  updatedOn?: string;
  status?: string;
  offlineForm?: boolean;
  tags?: string[];
  visitor?: { name?: string; email?: string; phone?: string };
  agent?: { name?: string };
  agentName?: string;
  messages?: { sender?: { t?: string; n?: string }; type?: string }[];
}
interface Ticket {
  id?: string;
  humanId?: number;
  createdOn?: string;
  updatedOn?: string;
  tags?: string[];
  requester?: { name?: string; email?: string; phone?: string };
  assignee?: { name?: string };
}

/** Last agent to send a message (last touch); falls back to assigned agent. */
function lastTouchAgent(c: Chat): string {
  const msgs = c.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const s = msgs[i].sender;
    if (s?.t === "a" && s?.n) return s.n;
  }
  return c.agent?.name || c.agentName || "";
}

export interface SyncResult {
  chats: number;
  tickets: number;
  attributes: number;
  days: number;
  from: string;
  to: string;
  finishedAt: string;
}

function cleanTags(tags: string[] | undefined): string[] {
  const t = (tags || []).filter((x) => typeof x === "string" && x.trim());
  return t.length ? t : [UNTAGGED];
}

// PostgreSQL rejects the U+0000 (null) code point in jsonb/text (SQLSTATE 22P05:
// "unsupported Unicode escape sequence"). Some tawk messages carry it, which made
// whole property batches fail to upsert. Strip it before any insert.
function stripNul<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(/\\u0000/g, "")) as T;
}
const noNul = (s: string | null | undefined): string | null =>
  s == null ? null : s.replace(new RegExp(String.fromCharCode(0), "g"), "");

/**
 * @param days how many days back to cover (inclusive of today). Default 2 so
 *             yesterday is always fully re-counted on the following run.
 * @param onlyPropertyId optionally sync a single property (for splitting load).
 */
export async function runSync(opts: { days?: number; onlyPropertyId?: string } = {}): Promise<SyncResult> {
  const sb = getSupabase();
  const days = Math.max(1, opts.days ?? 2);

  // Window aligned to the report-timezone day boundary so every covered day is whole.
  const now = new Date();
  const earliestDayKey = dateKeyInTz(new Date(now.getTime() - (days - 1) * 86400000));
  const startIso = localDayUtcRange(earliestDayKey).startUtc.toISOString();
  const endIso = now.toISOString();

  const properties = opts.onlyPropertyId
    ? PROPERTIES.filter((p) => p.id === opts.onlyPropertyId)
    : PROPERTIES;

  let chatCount = 0;
  let ticketCount = 0;
  let attrCount = 0;

  type CountRow = { day: string; property_id: string; property: string; chat_volume: number; missed: number; offline: number; tickets: number };
  type HourRow = { date: string; property_id: string; property: string; hour: number; chat_volume: number; missed: number; offline: number; tickets: number };
  type DriverRow = { day: string; property_id: string; property: string; driver: string; chats: number; tickets: number };
  type TagRow = Record<string, unknown>;
  const counts = new Map<string, CountRow>();
  const hourly = new Map<string, HourRow>();
  const drivers = new Map<string, DriverRow>();
  const tagRows: TagRow[] = [];
  const stamp = () => new Date().toISOString();

  const bumpCount = (day: string, prop: { id: string; name: string }, fn: (r: CountRow) => void) => {
    const k = `${day}|${prop.id}`;
    let r = counts.get(k);
    if (!r) { r = { day, property_id: prop.id, property: prop.name, chat_volume: 0, missed: 0, offline: 0, tickets: 0 }; counts.set(k, r); }
    fn(r);
  };
  const bumpHourly = (day: string, hour: number, prop: { id: string; name: string }, fn: (r: HourRow) => void) => {
    const k = `${day}|${prop.id}|${hour}`;
    let r = hourly.get(k);
    if (!r) { r = { date: day, property_id: prop.id, property: prop.name, hour, chat_volume: 0, missed: 0, offline: 0, tickets: 0 }; hourly.set(k, r); }
    fn(r);
  };
  const bumpDriver = (day: string, prop: { id: string; name: string }, tag: string, kind: "chats" | "tickets") => {
    const k = `${day}|${prop.id}|${tag}`;
    let r = drivers.get(k);
    if (!r) { r = { day, property_id: prop.id, property: prop.name, driver: tag, chats: 0, tickets: 0 }; drivers.set(k, r); }
    r[kind] += 1;
  };

  for (const prop of properties) {
    const chats = (await live.getChats(prop.id, startIso, endIso)) as Chat[];
    const tickets = (await live.getTickets(prop.id, startIso, endIso)) as Ticket[];

    // Upsert raw chats
    if (chats.length) {
      const rows = chats
        .filter((c) => c.id)
        .map((c) => ({
          id: c.id, property_id: prop.id, property: prop.name,
          created_on: c.createdOn ?? null, updated_on: c.updatedOn ?? null, raw: stripNul(c), synced_at: stamp(),
        }));
      const { error } = await sb.from("chats").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(`chats upsert (${prop.name}): ${error.message}`);
      chatCount += rows.length;
    }

    // Upsert raw tickets
    if (tickets.length) {
      const rows = tickets
        .filter((t) => t.id)
        .map((t) => ({
          id: t.id, human_id: t.humanId ?? null, property_id: prop.id, property: prop.name,
          created_on: t.createdOn ?? null, updated_on: t.updatedOn ?? null, raw: stripNul(t), synced_at: stamp(),
        }));
      const { error } = await sb.from("tickets").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(`tickets upsert (${prop.name}): ${error.message}`);
      ticketCount += rows.length;
    }

    // Aggregate summaries (by report-timezone day + hour) and seed chat_tags.
    for (const c of chats) {
      if (c.id) {
        tagRows.push({
          id: c.id, type: "chat", property_id: prop.id, property: prop.name,
          channel_user: noNul(c.visitor?.name), email: noNul(c.visitor?.email), phone: noNul(c.visitor?.phone),
          agent: noNul(lastTouchAgent(c))?.trim() || null, created_on: c.createdOn ?? null, last_seen: c.updatedOn ?? null, synced_at: stamp(),
        });
      }
      if (!c.createdOn) continue;
      const day = dateKeyInTz(c.createdOn);
      const hour = hourInTz(c.createdOn);
      // "missed" matches the Report tab: a non-offline chat that got no agent reply.
      const hadAgent = (c.messages || []).some((m) => m.sender?.t === "a" && m.type === "msg");
      const apply = (r: { chat_volume: number; missed: number; offline: number }) => {
        r.chat_volume += 1;
        if (c.offlineForm) r.offline += 1;
        else if (!hadAgent) r.missed += 1;
      };
      bumpCount(day, prop, apply);
      bumpHourly(day, hour, prop, apply);
      for (const tag of cleanTags(c.tags)) bumpDriver(day, prop, tag, "chats");
    }
    for (const t of tickets) {
      if (t.id) {
        tagRows.push({
          id: t.id, type: "ticket", property_id: prop.id, property: prop.name,
          channel_user: noNul(t.requester?.name), email: noNul(t.requester?.email), phone: noNul(t.requester?.phone),
          agent: noNul(t.assignee?.name)?.trim() || null, created_on: t.createdOn ?? null, last_seen: t.updatedOn ?? null, synced_at: stamp(),
        });
      }
      if (!t.createdOn) continue;
      const day = dateKeyInTz(t.createdOn);
      const hour = hourInTz(t.createdOn);
      bumpCount(day, prop, (r) => { r.tickets += 1; });
      bumpHourly(day, hour, prop, (r) => { r.tickets += 1; });
      for (const tag of cleanTags(t.tags)) bumpDriver(day, prop, tag, "tickets");
    }

    // Refresh custom attribute definitions
    for (const object of ["person", "organization"] as const) {
      try {
        const attrs = await live.getCustomAttributes(prop.id, object);
        if (attrs.length) {
          const rows = attrs.map((a) => ({
            property_id: prop.id, property: prop.name, object,
            key: a.key, label: a.label || a.key, data_type: a.dataType || "", synced_at: stamp(),
          }));
          const { error } = await sb.from("custom_attributes").upsert(rows, { onConflict: "property_id,object,key" });
          if (!error) attrCount += rows.length;
        }
      } catch {
        /* property may lack scope/attributes â€” skip */
      }
    }
  }

  // Upsert summary tables
  if (counts.size) {
    const rows = Array.from(counts.values()).map((r) => ({ ...r, updated_at: stamp() }));
    const { error } = await sb.from("daily_counts").upsert(rows, { onConflict: "day,property_id" });
    if (error) throw new Error(`daily_counts upsert: ${error.message}`);
  }
  if (drivers.size) {
    const rows = Array.from(drivers.values()).map((r) => ({ ...r, updated_at: stamp() }));
    const { error } = await sb.from("chat_drivers_daily").upsert(rows, { onConflict: "day,property_id,driver" });
    if (error) throw new Error(`chat_drivers_daily upsert: ${error.message}`);
  }
  if (hourly.size) {
    const rows = Array.from(hourly.values()).map((r) => ({ ...r, updated_at: stamp() }));
    const { error } = await sb.from("hourly_counts").upsert(rows, { onConflict: "date,property_id,hour" });
    if (error) throw new Error(`hourly_counts upsert: ${error.message}`);
  }
  // Seed chat_tags metadata (does NOT include drivers/channel_issue â†’ review tags preserved).
  for (let i = 0; i < tagRows.length; i += 500) {
    const batch = tagRows.slice(i, i + 500);
    const { error } = await sb.from("chat_tags").upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`chat_tags upsert: ${error.message}`);
  }

  const result: SyncResult = {
    chats: chatCount, tickets: ticketCount, attributes: attrCount,
    days, from: startIso, to: endIso, finishedAt: stamp(),
  };

  await sb.from("sync_state").upsert({ id: "tawk", last_synced_at: result.finishedAt, detail: result });

  return result;
}
