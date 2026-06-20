// ─────────────────────────────────────────────────────────────────────────
// Lightweight username/password auth for the dashboard.
//
// Accounts live in Supabase (app_users). A successful login issues an
// HMAC-signed session token stored in an httpOnly cookie. Every protected API
// route verifies that token server-side via requireAuth()/requireAdmin().
//
// Roles:
//   - admin : full dashboard, sees the Agent dropdown, manages accounts.
//   - agent : only their own chats/tickets (scoped server-side by agent_name).
//
// Node crypto only (scrypt + HMAC-SHA256) — no extra dependencies. Route
// handlers run on the Node.js runtime, so this is safe (not edge).
// ─────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const SESSION_COOKIE = "tawk_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12h

const AUTH_SECRET = process.env.AUTH_SECRET || "";
export const AUTH_CONFIGURED = AUTH_SECRET.length >= 16;

export type Role = "admin" | "agent";
export interface Session {
  userId: string;
  username: string;
  role: Role;
  /** Exact tawk display name used to scope an agent's chats; null for admins. */
  agentName: string | null;
}

// ─── Password hashing (scrypt) ───────────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = (stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1], "hex");
    const expected = Buffer.from(parts[2], "hex");
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ─── Signed session token (compact JWT-like: payload.signature) ───────────
const b64url = (b: Buffer) => b.toString("base64url");

function sign(payloadB64: string): string {
  return b64url(crypto.createHmac("sha256", AUTH_SECRET).update(payloadB64).digest());
}

export function createToken(session: Session): string {
  const payload = {
    sub: session.userId,
    u: session.username,
    role: session.role,
    agent: session.agentName,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifyToken(token: string | undefined | null): Session | null {
  if (!token || !AUTH_CONFIGURED) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  const expectedSig = sign(payloadB64);
  // Constant-time compare; lengths must match for timingSafeEqual.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (typeof p.exp !== "number" || p.exp < Math.floor(Date.now() / 1000)) return null;
    if (p.role !== "admin" && p.role !== "agent") return null;
    return { userId: String(p.sub), username: String(p.u), role: p.role, agentName: p.agent ?? null };
  } catch {
    return null;
  }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────
export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", httpOnly: true, maxAge: 0 });
}

export function getSession(req: NextRequest): Session | null {
  return verifyToken(req.cookies.get(SESSION_COOKIE)?.value);
}

// ─── Route guards ─────────────────────────────────────────────────────────
// Usage:
//   const g = requireAuth(req); if ("error" in g) return g.error;
//   const { session } = g;
type Guard = { session: Session } | { error: NextResponse };

export function requireAuth(req: NextRequest): Guard {
  if (!AUTH_CONFIGURED) return { error: NextResponse.json({ error: "Auth not configured (set AUTH_SECRET)" }, { status: 503 }) };
  const session = getSession(req);
  if (!session) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  return { session };
}

export function requireAdmin(req: NextRequest): Guard {
  const g = requireAuth(req);
  if ("error" in g) return g;
  if (g.session.role !== "admin") return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  return g;
}
