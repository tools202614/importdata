import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { requireAdmin, hashPassword, type Role } from "@/lib/auth";

export const dynamic = "force-dynamic";

const norm = (v: unknown) => String(v ?? "").trim();
const isRole = (r: string): r is Role => r === "admin" || r === "agent";

// How many OTHER active admins exist (used to prevent locking out the last admin).
async function otherActiveAdmins(excludeId: string): Promise<number> {
  const { data } = await getSupabase()
    .from("app_users")
    .select("id")
    .eq("role", "admin")
    .eq("active", true)
    .neq("id", excludeId);
  return data?.length ?? 0;
}

// GET /api/auth/users — list accounts (admin only).
export async function GET(req: NextRequest) {
  const g = requireAdmin(req);
  if ("error" in g) return g.error;
  const { data, error } = await getSupabase()
    .from("app_users")
    .select("id, username, role, agent_name, active, created_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

// POST /api/auth/users  body: { username, password, role, agentName? } (admin only)
export async function POST(req: NextRequest) {
  const g = requireAdmin(req);
  if ("error" in g) return g.error;
  try {
    const body = (await req.json()) ?? {};
    const username = norm(body.username).toLowerCase();
    const password = String(body.password ?? "");
    const role = norm(body.role) || "agent";
    const agentName = norm(body.agentName) || null;
    if (username.length < 3) return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    if (!isRole(role)) return NextResponse.json({ error: "role must be admin|agent" }, { status: 400 });
    if (role === "agent" && !agentName) return NextResponse.json({ error: "Agent accounts need an agent name (the exact tawk display name)" }, { status: 400 });

    const { data, error } = await getSupabase()
      .from("app_users")
      .insert({ username, password_hash: hashPassword(password), role, agent_name: role === "agent" ? agentName : null, active: true })
      .select("id, username, role, agent_name, active, created_at")
      .single();
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "Username already taken" }, { status: 409 });
      throw new Error(error.message);
    }
    return NextResponse.json({ user: data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

// PATCH /api/auth/users  body: { id, password?, role?, agentName?, active? } (admin only)
export async function PATCH(req: NextRequest) {
  const g = requireAdmin(req);
  if ("error" in g) return g.error;
  try {
    const body = (await req.json()) ?? {};
    const id = norm(body.id);
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (body.password !== undefined) {
      const p = String(body.password);
      if (p.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      patch.password_hash = hashPassword(p);
    }
    if (body.role !== undefined) {
      const role = norm(body.role);
      if (!isRole(role)) return NextResponse.json({ error: "role must be admin|agent" }, { status: 400 });
      patch.role = role;
    }
    if (body.agentName !== undefined) patch.agent_name = norm(body.agentName) || null;
    if (body.active !== undefined) patch.active = !!body.active;

    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    // Guard: don't strip the last admin (demotion or deactivation).
    const demoting = patch.role === "agent" || patch.active === false;
    if (demoting && (await otherActiveAdmins(id)) === 0) {
      // Only blocks if THIS user is the last active admin.
      const { data: self } = await getSupabase().from("app_users").select("role, active").eq("id", id).maybeSingle();
      if (self?.role === "admin" && self?.active) {
        return NextResponse.json({ error: "Can't demote/deactivate the last active admin" }, { status: 409 });
      }
    }

    const { data, error } = await getSupabase()
      .from("app_users")
      .update(patch)
      .eq("id", id)
      .select("id, username, role, agent_name, active, created_at")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ user: data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

// DELETE /api/auth/users  body: { id } (admin only)
export async function DELETE(req: NextRequest) {
  const g = requireAdmin(req);
  if ("error" in g) return g.error;
  try {
    const body = (await req.json()) ?? {};
    const id = norm(body.id);
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    if (id === g.session.userId) return NextResponse.json({ error: "You can't delete your own account" }, { status: 409 });

    const { data: target } = await getSupabase().from("app_users").select("role, active").eq("id", id).maybeSingle();
    if (target?.role === "admin" && target?.active && (await otherActiveAdmins(id)) === 0) {
      return NextResponse.json({ error: "Can't delete the last active admin" }, { status: 409 });
    }

    const { error } = await getSupabase().from("app_users").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
