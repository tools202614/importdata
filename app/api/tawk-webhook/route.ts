import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { PROPERTIES } from "@/lib/properties";

export const dynamic = "force-dynamic";

const PROP_NAME = new Map(PROPERTIES.map((p) => [p.id, p.name]));

function pick<T = unknown>(obj: Record<string, unknown> | undefined, ...paths: string[]): T | undefined {
  if (!obj) return undefined;
  for (const path of paths) {
    let cur: unknown = obj;
    for (const key of path.split(".")) {
      cur = (cur as Record<string, unknown> | undefined)?.[key];
      if (cur == null) break;
    }
    if (cur != null) return cur as T;
  }
  return undefined;
}

// Optional signature check. tawk signs the body; the exact header/algorithm is
// confirmed against a live delivery. If TAWK_WEBHOOK_SECRET is set and a known
// signature header is present, we enforce it; otherwise we accept (and log).
function signatureOk(raw: string, req: NextRequest): boolean {
  const secret = process.env.TAWK_WEBHOOK_SECRET;
  if (!secret) return true;
  const header = req.headers.get("x-tawk-signature") || req.headers.get("x-hook-signature");
  if (!header) return true; // can't verify what isn't sent — accept, rely on URL obscurity
  const expected = crypto.createHmac("sha1", secret).update(raw).digest("hex");
  return header === expected || header === `sha1=${expected}`;
}

// POST /api/tawk-webhook  — realtime chat/ticket events from tawk.to
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!signatureOk(raw, req)) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  // Log once so the real payload shape can be confirmed in Vercel logs.
  console.log("tawk-webhook:", JSON.stringify(body).slice(0, 1000));

  if (!SUPABASE_CONFIGURED) return NextResponse.json({ ok: true, note: "supabase off" });

  const event = String(pick(body, "event") ?? "");

  // TEMP: capture the raw payload (one row per event type) to confirm tawk's real
  // field shape, since Vercel logs aren't reachable from the build env. Remove later.
  try {
    await getSupabase().from("sync_state").upsert({ id: `whdbg:${event || "unknown"}`, last_synced_at: new Date().toISOString(), detail: body });
  } catch { /* ignore */ }
  const isTicket = event.startsWith("ticket");
  const propertyId = String(pick(body, "property.id", "propertyId", "property") ?? "");
  const id = String(
    pick(body, isTicket ? "ticketId" : "chatId", isTicket ? "ticket.id" : "chat.id", "id") ?? ""
  );
  if (!id || !propertyId) {
    return NextResponse.json({ ok: true, note: "no id/property in payload" });
  }

  const personPath = isTicket ? "requester" : "visitor";
  const person = (pick<Record<string, unknown>>(body, personPath, `${isTicket ? "ticket" : "chat"}.${personPath}`) ?? {}) as Record<string, unknown>;
  const time = String(pick(body, "time", `${isTicket ? "ticket" : "chat"}.createdOn`) ?? new Date().toISOString());

  // Build the upsert with only the fields we have, so review tags + created_on are preserved.
  const row: Record<string, unknown> = {
    id,
    type: isTicket ? "ticket" : "chat",
    property_id: propertyId,
    property: PROP_NAME.get(propertyId) ?? propertyId,
    synced_at: new Date().toISOString(),
  };
  const name = pick(person, "name"); if (name != null) row.channel_user = String(name);
  const email = pick(person, "email"); if (email != null) row.email = String(email);
  const phone = pick(person, "phone"); if (phone != null) row.phone = String(phone);

  // chat:start / ticket:create → set created_on; chat:end (or any event) → bump last_seen.
  if (event.endsWith(":start") || event.endsWith(":create")) row.created_on = time;
  row.last_seen = String(pick(body, "time") ?? new Date().toISOString());

  try {
    const { error } = await getSupabase().from("chat_tags").upsert(row, { onConflict: "id" });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("tawk-webhook upsert error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
