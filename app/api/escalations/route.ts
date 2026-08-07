import { NextRequest, NextResponse } from "next/server";
import {
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  updateRecord,
  ListFilters,
} from "@/lib/escalation-store";
import { requireAuth, type Session } from "@/lib/auth";

// Always read/write fresh — never cache escalation data.
export const dynamic = "force-dynamic";

// Forms an agent is allowed to create/see. Admins can use any form.
const AGENT_FORMS = new Set(["chargeback", "refund"]);

// Escalations are for agents (own records) and admins (all). HR is excluded.
function gate(session: Session): NextResponse | null {
  if (session.role !== "agent" && session.role !== "admin") {
    return NextResponse.json({ error: "Not available for this role" }, { status: 403 });
  }
  return null;
}

// GET /api/escalations?formId=&property=&status=&from=&to=&q=
// Agents see only their own records; admins see everyone's.
export async function GET(req: NextRequest) {
  const g = await requireAuth(req);
  if ("error" in g) return g.error;
  const { session } = g;
  const denied = gate(session);
  if (denied) return denied;

  const { searchParams } = req.nextUrl;
  const filters: ListFilters = {
    formId: searchParams.get("formId") || undefined,
    property: searchParams.get("property") || undefined,
    status: searchParams.get("status") || undefined,
    driver: searchParams.get("driver") || undefined,
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    q: searchParams.get("q") || undefined,
  };
  // Agents are scoped to their own records server-side.
  if (session.role === "agent") filters.createdBy = session.username;

  try {
    const rows = await listRecords(filters);
    return NextResponse.json({ rows });
  } catch (err) {
    console.error("Escalations list error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/escalations  body: { formId, data } — create a record (stamps owner).
export async function POST(req: NextRequest) {
  const g = await requireAuth(req);
  if ("error" in g) return g.error;
  const { session } = g;
  const denied = gate(session);
  if (denied) return denied;
  try {
    const body = await req.json();
    const { formId, data } = body ?? {};
    if (!formId || typeof formId !== "string") {
      return NextResponse.json({ error: "formId is required" }, { status: 400 });
    }
    if (session.role === "agent" && !AGENT_FORMS.has(formId)) {
      return NextResponse.json({ error: "Agents can only create chargeback/refund records" }, { status: 403 });
    }
    const record = await createRecord(formId, data ?? {}, {
      createdBy: session.username,
      agentName: session.agentName ?? null,
    });
    return NextResponse.json({ record }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

// Agents may only touch their OWN records; admins any. Returns an error response
// if the caller may not act on this record, else null.
async function ownershipGuard(session: Session, id: string): Promise<NextResponse | null> {
  if (session.role === "admin") return null;
  const existing = await getRecord(id);
  if (!existing) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  if (existing.createdBy !== session.username) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

// PATCH /api/escalations  body: { id, data }
export async function PATCH(req: NextRequest) {
  const g = await requireAuth(req);
  if ("error" in g) return g.error;
  const { session } = g;
  const denied = gate(session);
  if (denied) return denied;
  try {
    const body = await req.json();
    const { id, data } = body ?? {};
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const owner = await ownershipGuard(session, id);
    if (owner) return owner;
    const record = await updateRecord(id, data ?? {});
    return NextResponse.json({ record });
  } catch (err) {
    const msg = String(err);
    const status = msg.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/escalations?id=
export async function DELETE(req: NextRequest) {
  const g = await requireAuth(req);
  if ("error" in g) return g.error;
  const { session } = g;
  const denied = gate(session);
  if (denied) return denied;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    const owner = await ownershipGuard(session, id);
    if (owner) return owner;
    const ok = await deleteRecord(id);
    if (!ok) return NextResponse.json({ error: "Record not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
