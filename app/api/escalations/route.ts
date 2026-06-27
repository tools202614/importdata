import { NextRequest, NextResponse } from "next/server";
import {
  createRecord,
  deleteRecord,
  listRecords,
  updateRecord,
  ListFilters,
} from "@/lib/escalation-store";
import { requireAdmin } from "@/lib/auth";

// Always read/write fresh — never cache escalation data.
export const dynamic = "force-dynamic";

// GET /api/escalations?formId=&property=&status=&from=&to=&q=
export async function GET(req: NextRequest) {
  const g = await requireAdmin(req);
  if ("error" in g) return g.error;
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

  try {
    const rows = await listRecords(filters);
    return NextResponse.json({ rows });
  } catch (err) {
    console.error("Escalations list error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/escalations  body: { formId, data }
export async function POST(req: NextRequest) {
  const g = await requireAdmin(req);
  if ("error" in g) return g.error;
  try {
    const body = await req.json();
    const { formId, data } = body ?? {};
    if (!formId || typeof formId !== "string") {
      return NextResponse.json({ error: "formId is required" }, { status: 400 });
    }
    const record = await createRecord(formId, data ?? {});
    return NextResponse.json({ record }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

// PATCH /api/escalations  body: { id, data }
export async function PATCH(req: NextRequest) {
  const g = await requireAdmin(req);
  if ("error" in g) return g.error;
  try {
    const body = await req.json();
    const { id, data } = body ?? {};
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
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
  const g = await requireAdmin(req);
  if ("error" in g) return g.error;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    const ok = await deleteRecord(id);
    if (!ok) return NextResponse.json({ error: "Record not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
