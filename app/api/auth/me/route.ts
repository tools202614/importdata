import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/auth/me — current session, with role/name read live from the DB
// (so account edits apply without re-login). 401 if not logged in / disabled.
export async function GET(req: NextRequest) {
  const session = await getSessionUser(req);
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({
    authenticated: true,
    user: { username: session.username, role: session.role, agentName: session.agentName },
  });
}
