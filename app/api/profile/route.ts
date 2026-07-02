import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Editable profile columns (whitelist). photo_url is set via /api/profile/photo.
const FIELDS = [
  "last_name", "first_name", "middle_name", "signal_nickname",
  "mobile_number", "carepack_email", "getva_email", "home_address", "emergency_contact",
  "employee_id", "position", "department", "wisetags",
] as const;

// GET /api/profile?userId=  — an account's profile + basic account info.
// Agents can only read their OWN; HR/admin can read anyone (via userId).
export async function GET(req: NextRequest) {
  const g = await requireAuth(req);
  if ("error" in g) return g.error;
  const { session } = g;
  const canAll = session.role === "admin" || session.role === "hr";
  const requested = req.nextUrl.searchParams.get("userId");
  const userId = canAll && requested ? requested : session.userId;

  try {
    const sb = getSupabase();
    const [{ data: user, error: uErr }, { data: profile, error: pErr }] = await Promise.all([
      sb.from("app_users").select("id, username, role, agent_name, active").eq("id", userId).maybeSingle(),
      sb.from("employee_profiles").select("*").eq("user_id", userId).maybeSingle(),
    ]);
    if (uErr) throw new Error(uErr.message);
    if (pErr) throw new Error(pErr.message);
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ user, profile: profile ?? null, canEdit: canAll });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH /api/profile  body: { userId, ...fields } — upsert a profile (HR/admin only).
export async function PATCH(req: NextRequest) {
  const g = await requireAuth(req);
  if ("error" in g) return g.error;
  const { session } = g;
  if (session.role !== "admin" && session.role !== "hr") {
    return NextResponse.json({ error: "HR or admin only" }, { status: 403 });
  }
  try {
    const body = (await req.json()) ?? {};
    const userId = String(body.userId ?? "").trim();
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

    const row: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString(), updated_by: session.username };
    for (const f of FIELDS) {
      if (body[f] !== undefined) row[f] = String(body[f] ?? "").trim() || null;
    }

    const { data, error } = await getSupabase()
      .from("employee_profiles")
      .upsert(row, { onConflict: "user_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ profile: data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
