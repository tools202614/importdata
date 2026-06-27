import { NextRequest, NextResponse } from "next/server";
import { getChatById, getTicketById } from "@/lib/tawk-api";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Raw = Record<string, unknown>;
interface Msg { sender: string; senderType: string; text: string; time: string }

function normalizeChat(raw: Raw): { messages: Msg[]; transcript: string } {
  const list = (raw.messages as { sender?: { t?: string; n?: string }; type?: string; msg?: string; time?: string }[] | undefined) || [];
  const messages: Msg[] = [];
  for (const m of list) {
    const text = m.msg || "";
    if (!text) continue;
    const t = m.sender?.t || "s";
    const sender = m.sender?.n || (t === "v" ? "Visitor" : t === "a" ? "Agent" : "System");
    messages.push({ sender, senderType: t, text, time: m.time || "" });
  }
  const transcript = messages.map((m) => `${m.sender}: ${m.text}`).join("\n");
  return { messages, transcript };
}

// GET /api/chat-detail?id=&propertyId=&type=chat|ticket
export async function GET(req: NextRequest) {
  const g = await requireAuth(req);
  if ("error" in g) return g.error;
  const { session } = g;
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  const propertyId = sp.get("propertyId");
  const type = sp.get("type") || "chat";
  if (!id || !propertyId) return NextResponse.json({ error: "id and propertyId required" }, { status: 400 });

  // Agents may only open their own conversations (normalized name match).
  if (session.role === "agent") {
    const target = (session.agentName ?? "").trim().toLowerCase();
    if (!target || !SUPABASE_CONFIGURED) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { data } = await getSupabase().from("chat_tags").select("agent").eq("id", id).maybeSingle();
    if (!data || (data.agent ?? "").trim().toLowerCase() !== target) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    if (type === "ticket") {
      const t = await getTicketById(propertyId, id);
      const transcript = [t.subject ? `Subject: ${t.subject}` : "", t.message ? String(t.message) : ""].filter(Boolean).join("\n\n");
      return NextResponse.json({
        type: "ticket",
        subject: t.subject ?? "",
        message: t.message ?? "",
        requester: t.requester ?? null,
        status: t.status ?? "",
        transcript,
      });
    }

    let raw: Raw;
    try {
      raw = await getChatById(propertyId, id);
    } catch {
      // Fallback to synced raw if the live call fails.
      raw = {};
      if (SUPABASE_CONFIGURED) {
        const { data } = await getSupabase().from("chats").select("raw").eq("id", id).maybeSingle();
        if (data?.raw) raw = data.raw as Raw;
      }
    }
    const { messages, transcript } = normalizeChat(raw);
    return NextResponse.json({
      type: "chat",
      visitor: raw.visitor ?? null,
      messages,
      transcript,
    });
  } catch (err) {
    console.error("chat-detail error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
