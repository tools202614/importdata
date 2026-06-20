import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET /api/auth/me — current session (or 401 if not logged in).
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({
    authenticated: true,
    user: { username: session.username, role: session.role, agentName: session.agentName },
  });
}
