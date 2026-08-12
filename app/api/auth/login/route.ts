import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_CONFIGURED, getSupabase } from "@/lib/supabase";
import { AUTH_CONFIGURED, verifyPassword, createToken, setSessionCookie, type Role } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface UserRow { id: string; username: string; password_hash: string; role: Role; agent_name: string | null; active: boolean }

// POST /api/auth/login  body: { username, password }
export async function POST(req: NextRequest) {
  if (!AUTH_CONFIGURED) return NextResponse.json({ error: "Auth not configured (set AUTH_SECRET)" }, { status: 503 });
  if (!SUPABASE_CONFIGURED) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  try {
    const { username, password } = (await req.json()) ?? {};
    const u = String(username ?? "").trim().toLowerCase();
    const p = String(password ?? "");
    if (!u || !p) return NextResponse.json({ error: "Username and password required" }, { status: 400 });

    const { data, error } = await getSupabase()
      .from("app_users")
      .select("id, username, password_hash, role, agent_name, active")
      .eq("username", u)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const user = data as UserRow | null;
    // Same response whether the user is missing or the password is wrong.
    if (!user || !user.active || !verifyPassword(p, user.password_hash)) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }

    const session = { userId: user.id, username: user.username, role: user.role, agentName: user.agent_name ?? null };
    const res = NextResponse.json({ user: { username: user.username, role: user.role, agentName: user.agent_name ?? null } });
    setSessionCookie(res, createToken(session));
    return res;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

<button
  type="button"
  onclick="window.location.href='https://your-target-url.com'"
  style="
    padding: 10px 20px;
    background: #1E4B3C;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  "
>
  Go to Site
</button>
