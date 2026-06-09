// ─────────────────────────────────────────────────────────────────────────
// Sync job: tawk.to → Supabase.
//
// For a recent window it pulls chats & tickets for every property, upserts the
// raw objects, recomputes the daily summary tables (daily_counts +
// chat_drivers_daily) for the covered days, refreshes custom attributes, and
// stamps sync_state. Re-run daily with a small overlap so each day gets a full
// recount the day after (statuses settle, late items get picked up).
// ─────────────────────────────────────────────────────────────────────────

import { getSupabase } from "./supabase";
import { PROPERTIES } from "./properties";
import { dateKeyInTz, localDayUtcRange } from "./config";
import { UNTAGGED } from "./drivers";
import * as live from "./tawk-api";

interface Chat {
  id?: string;
  createdOn?: string;
  updatedOn?: string;
  status?: string;
  offlineForm?: boolean;
  tags?: string[];
  messages?: { sender?: { t?: string }; type?: string }[];
}
interface Ticket {
  id?: string;
  humanId?: number;
  createdOn?: string;
  updatedOn?: string;
  tags?: string[];
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
  type DriverRow = { day: string; property_id: string; property: string; driver: string; chats: number; tickets: number };
  const counts = new Map<string, CountRow>();
  const drivers = new Map<string, DriverRow>();
  const stamp = () => new Date().toISOString();

  const bumpCount = (day: string, prop: { id: string; name: string }, fn: (r: CountRow) => void) => {
    const k = `${day}|${prop.id}`;
    let r = counts.get(k);
    if (!r) { r = { day, property_id: prop.id, property: prop.name, chat_volume: 0, missed: 0, offline: 0, tickets: 0 }; counts.set(k, r); }
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
          created_on: c.createdOn ?? null, updated_on: c.updatedOn ?? null, raw: c, synced_at: stamp(),
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
          created_on: t.createdOn ?? null, updated_on: t.updatedOn ?? null, raw: t, synced_at: stamp(),
        }));
      const { error } = await sb.from("tickets").upsert(rows, { onConflict: "id" });
      if (error) throw new Error(`tickets upsert (${prop.name}): ${error.message}`);
      ticketCount += rows.length;
    }

    // Aggregate summaries (by report-timezone day)
    for (const c of chats) {
      if (!c.createdOn) continue;
      const day = dateKeyInTz(c.createdOn);
      // "missed" matches the Report tab: a non-offline chat that got no agent reply.
      const hadAgent = (c.messages || []).some((m) => m.sender?.t === "a" && m.type === "msg");
      bumpCount(day, prop, (r) => {
        r.chat_volume += 1;
        if (c.offlineForm) r.offline += 1;
        else if (!hadAgent) r.missed += 1;
      });
      for (const tag of cleanTags(c.tags)) bumpDriver(day, prop, tag, "chats");
    }
    for (const t of tickets) {
      if (!t.createdOn) continue;
      const day = dateKeyInTz(t.createdOn);
      bumpCount(day, prop, (r) => { r.tickets += 1; });
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
        /* property may lack scope/attributes — skip */
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

  const result: SyncResult = {
    chats: chatCount, tickets: ticketCount, attributes: attrCount,
    days, from: startIso, to: endIso, finishedAt: stamp(),
  };

  await sb.from("sync_state").upsert({ id: "tawk", last_synced_at: result.finishedAt, detail: result });

  return result;
}
