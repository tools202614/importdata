import { NextRequest, NextResponse } from "next/server";
import { PROPERTIES } from "@/lib/properties";
import { createWebhook, listWebhooks, removeWebhook } from "@/lib/tawk-api";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EVENTS = ["chat:start", "chat:end", "ticket:create"];
const HOOK_NAME = "tawk-dashboard";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function hookUrl(req: NextRequest): string {
  return process.env.WEBHOOK_URL || `${req.nextUrl.origin}/api/tawk-webhook`;
}

// POST /api/webhooks/register — create the realtime webhook on every property
// (idempotent: skips a property that already points to this URL).
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = hookUrl(req);
  const results: { property: string; action: string; hookId?: string; error?: string }[] = [];

  for (const prop of PROPERTIES) {
    try {
      const existing = await listWebhooks(prop.id);
      if (existing.some((w) => w.url === url)) {
        results.push({ property: prop.name, action: "exists" });
        continue;
      }
      const hookId = await createWebhook(prop.id, EVENTS, url, HOOK_NAME);
      results.push({ property: prop.name, action: "created", hookId });
    } catch (err) {
      results.push({ property: prop.name, action: "error", error: String(err) });
    }
  }
  return NextResponse.json({ url, events: EVENTS, results });
}

// GET — list this app's webhooks across properties.
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = hookUrl(req);
  const results: { property: string; hooks: { hookId?: string; url?: string; events?: string[] }[] }[] = [];
  for (const prop of PROPERTIES) {
    try {
      const hooks = (await listWebhooks(prop.id)).filter((w) => w.url === url || w.name === HOOK_NAME);
      results.push({ property: prop.name, hooks });
    } catch {
      results.push({ property: prop.name, hooks: [] });
    }
  }
  return NextResponse.json({ url, results });
}

// DELETE — remove this app's webhooks from every property.
export async function DELETE(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = hookUrl(req);
  const results: { property: string; removed: number }[] = [];
  for (const prop of PROPERTIES) {
    let removed = 0;
    try {
      const hooks = (await listWebhooks(prop.id)).filter((w) => w.url === url || w.name === HOOK_NAME);
      for (const h of hooks) {
        if (h.hookId) { await removeWebhook(prop.id, h.hookId); removed += 1; }
      }
    } catch { /* skip */ }
    results.push({ property: prop.name, removed });
  }
  return NextResponse.json({ results });
}
