"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";

export interface AuthUser {
  username: string;
  role: "admin" | "agent" | "hr";
  agentName: string | null;
}

interface AuthCtx {
  user: AuthUser;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within <AuthProvider>");
  return c;
}

/** Gates the whole app: shows a login (or first-run setup) screen until authenticated. */
export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const d = await res.json();
        setUser(d.user as AuthUser);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
    }
  }, []);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-400">
        Loading…
      </div>
    );
  }

  if (!user) return <LoginScreen onAuthed={refresh} />;

  return <Ctx.Provider value={{ user, logout }}>{children}</Ctx.Provider>;
}

// ─── Login / first-run setup screen ──────────────────────────────────────
interface Status {
  authConfigured: boolean;
  supabaseConfigured: boolean;
  tableReady: boolean;
  needsSetup: boolean;
  hint?: string;
}

function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ authConfigured: false, supabaseConfigured: false, tableReady: false, needsSetup: false }));
  }, []);

  const setupMode = !!status?.needsSetup;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (setupMode && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const url = setupMode ? "/api/auth/setup" : "/api/auth/login";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onAuthed();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  const notReady =
    status && (!status.authConfigured || !status.supabaseConfigured || !status.tableReady);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl border border-gray-200 shadow-sm p-7">
        <h1 className="text-xl font-bold text-gray-900">Tawk.to Reports</h1>
        <p className="text-sm text-gray-500 mt-1">
          {setupMode ? "First-time setup — create the admin account." : "Sign in to continue."}
        </p>

        {notReady ? (
          <div className="mt-5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
            {!status?.authConfigured && <p>• Set <code>AUTH_SECRET</code> in the environment.</p>}
            {!status?.supabaseConfigured && <p>• Supabase is not configured.</p>}
            {status?.authConfigured && status?.supabaseConfigured && !status?.tableReady && (
              <p>• Run <code>supabase/auth.sql</code> in the Supabase SQL Editor, then reload.</p>
            )}
            {status?.hint && <p className="text-amber-600/80 text-xs mt-1">{status.hint}</p>}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={setupMode ? "new-password" : "current-password"}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            {setupMode && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Confirm password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy || !username || !password}
              className="w-full bg-gray-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
            >
              {busy ? "Please wait…" : setupMode ? "Create admin & sign in" : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Reusable header control: who's signed in + logout (+ optional links) ──
export function UserMenu({ reportsLink = false }: { reportsLink?: boolean }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex items-center gap-3 text-sm shrink-0">
      {reportsLink && user.role === "admin" && (
        <Link href="/" className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50 transition-colors">
          ← Reports
        </Link>
      )}
      <Link href="/profile" className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50 transition-colors">
        My Profile
      </Link>
      <span className="text-gray-500">
        {user.username}
        <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[11px] bg-gray-100 text-gray-600">{user.role}</span>
      </span>
      <button
        onClick={logout}
        className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50 transition-colors"
      >
        Logout
      </button>
    </div>
  );
}
