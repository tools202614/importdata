"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import ProfileCard from "./ProfileCard";

interface Row {
  id: string;
  username: string;
  role: string;
  agent_name: string | null;
  active: boolean;
  profile: { last_name?: string | null; first_name?: string | null } | null;
}

export default function ProfilesPanel() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user.role !== "admin" && user.role !== "hr") return;
    fetch("/api/profiles")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRows(d.rows);
        setSelected((s) => s ?? (d.rows[0]?.id ?? null));
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [user.role]);

  if (user.role !== "admin" && user.role !== "hr") {
    return <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 text-sm text-gray-500">HR or admin access required.</div>;
  }

  const filtered = query
    ? rows.filter((r) => {
        const name = [r.profile?.last_name, r.profile?.first_name].filter(Boolean).join(" ").toLowerCase();
        return r.username.toLowerCase().includes(query.toLowerCase()) || name.includes(query.toLowerCase());
      })
    : rows;

  const label = (r: Row) => [r.profile?.last_name, r.profile?.first_name].filter(Boolean).join(", ") || r.username;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
      {/* Account list */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="p-3 border-b border-gray-200">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or username…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={`w-full text-left px-4 py-2.5 border-b border-gray-100 hover:bg-gray-50 ${selected === r.id ? "bg-blue-50" : ""}`}
            >
              <div className="text-sm font-medium text-gray-900 truncate">{label(r)}</div>
              <div className="text-xs text-gray-500">
                @{r.username}
                <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] bg-gray-100 text-gray-600">{r.role}</span>
                {!r.active && <span className="ml-1 text-red-400">disabled</span>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-center py-8 text-sm text-gray-400">No accounts.</p>}
        </div>
        {error && <p className="p-3 text-sm text-red-600">{error}</p>}
      </div>

      {/* Editor */}
      <div>{selected ? <ProfileCard key={selected} userId={selected} editable /> : <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 text-sm text-gray-400">Select an account to edit its profile.</div>}</div>
    </div>
  );
}
