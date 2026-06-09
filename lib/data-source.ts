// ─────────────────────────────────────────────────────────────────────────
// Read side for the reporting tabs.
//
//   • Supabase configured → read synced rows from Supabase  (fast, production)
//   • not configured      → call the tawk.to API live        (local dev fallback)
//
// Returns the raw tawk objects either way, so the existing aggregation logic in
// the report routes works unchanged regardless of source.
// ─────────────────────────────────────────────────────────────────────────

import { SUPABASE_CONFIGURED, getSupabase } from "./supabase";
import { PROPERTIES } from "./properties";
import * as live from "./tawk-api";

type Raw = Record<string, unknown>;

async function selectRange(table: "chats" | "tickets", propertyId: string, startDate: string, endDate: string): Promise<Raw[]> {
  const sb = getSupabase();
  const out: Raw[] = [];
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select("raw")
      .eq("property_id", propertyId)
      .gte("created_on", startDate)
      .lte("created_on", endDate)
      .order("created_on", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table} read: ${error.message}`);
    const rows = (data ?? []) as { raw: Raw }[];
    out.push(...rows.map((r) => r.raw));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

export async function getChats(propertyId: string, startDate: string, endDate: string): Promise<Raw[]> {
  if (!SUPABASE_CONFIGURED) return (await live.getChats(propertyId, startDate, endDate)) as Raw[];
  return selectRange("chats", propertyId, startDate, endDate);
}

export async function getTickets(propertyId: string, startDate: string, endDate: string): Promise<Raw[]> {
  if (!SUPABASE_CONFIGURED) return (await live.getTickets(propertyId, startDate, endDate)) as Raw[];
  return selectRange("tickets", propertyId, startDate, endDate);
}

export interface AttributeRow {
  property: string;
  object: string;
  key: string;
  label: string;
  dataType: string;
}

export async function getCustomAttributeRows(): Promise<AttributeRow[]> {
  if (!SUPABASE_CONFIGURED) {
    // Live fallback: query each property/object directly from tawk.to.
    const rows: AttributeRow[] = [];
    for (const prop of PROPERTIES) {
      for (const object of ["person", "organization"] as const) {
        try {
          const attrs = await live.getCustomAttributes(prop.id, object);
          for (const a of attrs) {
            rows.push({ property: prop.name, object, key: a.key, label: a.label || a.key, dataType: a.dataType || "" });
          }
        } catch {
          /* skip properties without scope/attributes */
        }
      }
    }
    return rows;
  }

  const sb = getSupabase();
  const { data, error } = await sb.from("custom_attributes").select("*").limit(10000);
  if (error) throw new Error(`custom_attributes read: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    property: String(r.property ?? ""),
    object: String(r.object ?? ""),
    key: String(r.key ?? ""),
    label: String(r.label ?? r.key ?? ""),
    dataType: String(r.data_type ?? ""),
  }));
}
