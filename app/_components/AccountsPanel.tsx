"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";

interface Account {
  id: string;
  username: string;
  role: "admin" | "agent";
  agent_name: string | null;
  active: boolean;
  created_at: string;
}

const fmt = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
};

export default function AccountsPanel() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [agentNames, setAgentNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // New-account form
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "agent">("agent");
  const [agentName, setAgentName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setAccounts(data.users);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user.role !== "admin") return;
    load();
    fetch("/api/auth/agent-names")
      .then((r) => (r.ok ? r.json() : { names: [] }))
      .then((d) => setAgentNames(d.names ?? []))
      .catch(() => setAgentNames([]));
  }, [user.role, load]);

  if (user.role !== "admin") {
    return <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 text-sm text-gray-500">Admin access required.</div>;
  }

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      const res = await fetch("/api/auth/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role, agentName: role === "agent" ? agentName : null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setUsername("");
      setPassword("");
      setAgentName("");
      setRole("agent");
      await load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError("");
    try {
      const res = await fetch("/api/auth/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }

  async function resetPassword(a: Account) {
    const pw = window.prompt(`New password for "${a.username}" (min 8 chars):`);
    if (pw == null) return;
    if (pw.length < 8) { setError("Password must be at least 8 characters"); return; }
    await patch(a.id, { password: pw });
  }

  async function remove(a: Account) {
    if (!window.confirm(`Delete account "${a.username}"? This cannot be undone.`)) return;
    setError("");
    try {
      const res = await fetch("/api/auth/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: a.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  }

  return (
    <div className="space-y-5">
      {/* Create */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Add account</h2>
        <form onSubmit={createAccount} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Password</label>
            <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 8 chars" className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "agent")} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="agent">agent</option>
              <option value="admin">admin</option>
            </select>
          </div>
          {role === "agent" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Agent name (exact tawk name)</label>
              <input list="agent-names" value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. Maria Santos" className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 min-w-[220px]" />
              <datalist id="agent-names">
                {agentNames.map((n) => <option key={n} value={n} />)}
              </datalist>
            </div>
          )}
          <button type="submit" disabled={creating} className="bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
            {creating ? "Adding…" : "Add account"}
          </button>
        </form>
        <p className="mt-2 text-xs text-gray-400">Agent accounts only see chats/tickets handled by the matching agent name. The name must match the tawk display name exactly.</p>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {/* List */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Accounts — {accounts.length}</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-white">
                <th className="px-3 py-2 text-left font-medium">Username</th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-left font-medium">Agent name</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Created</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a, i) => (
                <tr key={a.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-3 py-2 font-medium">{a.username}</td>
                  <td className="px-3 py-2">
                    <select
                      value={a.role}
                      onChange={(e) => patch(a.id, { role: e.target.value })}
                      className="border border-gray-300 rounded px-2 py-1 text-xs"
                    >
                      <option value="agent">agent</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    {a.role === "agent" ? (
                      <input
                        list="agent-names"
                        defaultValue={a.agent_name ?? ""}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (a.agent_name ?? "")) patch(a.id, { agentName: v }); }}
                        placeholder="—"
                        className="border border-gray-300 rounded px-2 py-1 text-xs min-w-[180px]"
                      />
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${a.active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600"}`}>
                      {a.active ? "active" : "disabled"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{fmt(a.created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => resetPassword(a)} className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50">Reset password</button>
                      <button onClick={() => patch(a.id, { active: !a.active })} className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50">{a.active ? "Disable" : "Enable"}</button>
                      <button onClick={() => remove(a)} className="text-xs border border-red-200 text-red-600 rounded px-2 py-1 hover:bg-red-50">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && !loading && (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400">No accounts yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
