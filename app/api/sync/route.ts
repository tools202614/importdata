import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/sync";
import { SUPABASE_CONFIGURED } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // syncs all properties; needs a plan allowing long functions

// Optional hardening: if CRON_SECRET is set, require a matching bearer token.
// Supabase Cron / Vercel Cron send it; leave unset to keep the endpoint open
// (then protect the whole app at the platform level — it has no built-in auth).
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!SUPABASE_CONFIGURED) {
    return NextResponse.json({ error: "Supabase not configured (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)" }, { status: 503 });
  }
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const days = Number(req.nextUrl.searchParams.get("days")) || undefined;
  const onlyPropertyId = req.nextUrl.searchParams.get("property") || undefined;
  try {
    const result = await runSync({ days, onlyPropertyId });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("Sync error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// GET — used by cron schedulers.
export async function GET(req: NextRequest) {
  return handle(req);
}

// POST — used by the manual "Sync now" button (and Supabase pg_net http_post).
export async function POST(req: NextRequest) {
  return handle(req);
}
