"use client";

import { useEffect, useRef, useState } from "react";
import { localDayUtcRange } from "@/lib/config";
import { PROPERTIES } from "@/lib/properties";
import { CHAT_DRIVER_OPTIONS, CHANNEL_ISSUE_OPTIONS } from "@/lib/chat-tags";

interface Row {
  id: string;
  type: "chat" | "ticket";
  property: string;
  propertyId: string;
  channelUser: string;
  email: string;
  phone: string;
  createdOn: string;
  lastSeen: string;
  agent: string;
  drivers: string[];
  driversUpdatedAt: string | null;
  channelIssue: string[];
  channelIssueUpdatedAt: string | null;
}

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ─── Multi-select dropdown (checkbox popover) ────────
function MultiSelect({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function toggle(opt: string) {
    if (opt === "None") { onChange(["None"]); return; }
    const next = selected.includes(opt)
      ? selected.filter((o) => o !== opt)
      : [...selected.filter((o) => o !== "None"), opt];
    onChange(next);
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full min-w-[150px] text-left border border-gray-300 rounded px-2 py-1 text-xs hover:bg-gray-50 flex flex-wrap gap-1 items-center"
      >
        {selected.length ? (
          selected.map((s) => (
            <span key={s} className="inline-block bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded text-[11px]">{s}</span>
          ))
        ) : (
          <span className="text-gray-400">— select —</span>
        )}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-72 max-h-64 overflow-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          {options.map((opt) => (
            <label key={opt} className="flex items-start gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-xs">
              <input type="checkbox" className="mt-0.5" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ChatsPanel() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "chat" | "ticket">("");
  const [property, setProperty] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Conversation modal
  const [modalRow, setModalRow] = useState<Row | null>(null);
  const [detail, setDetail] = useState<{ type?: string; messages?: { sender: string; senderType: string; text: string; time: string }[]; subject?: string; message?: string; transcript?: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setFrom(today);
    setTo(today);
  }, []);

  async function load() {
    if (!from || !to) return;
    setLoading(true);
    setError("");
    try {
      const startUtc = localDayUtcRange(from).startUtc.toISOString();
      const endUtc = localDayUtcRange(to).endUtc.toISOString();
      const params = new URLSearchParams({ startDate: startUtc, endDate: endUtc });
      if (typeFilter) params.set("type", typeFilter);
      if (property) params.set("property", property);
      if (query) params.set("q", query);
      const res = await fetch(`/api/chats-list?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setRows(data.rows);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function saveTags(row: Row, field: "drivers" | "channelIssue", values: string[]) {
    // optimistic
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, [field]: values } : r)));
    try {
      const body = field === "drivers"
        ? { id: row.id, type: row.type, drivers: values }
        : { id: row.id, type: row.type, channelIssue: values };
      const res = await fetch("/api/chat-tags", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      const t = data.tag;
      setRows((prev) => prev.map((r) => (r.id === row.id ? {
        ...r,
        drivers: t.drivers ?? r.drivers,
        driversUpdatedAt: t.drivers_updated_at ?? r.driversUpdatedAt,
        channelIssue: t.channel_issue ?? r.channelIssue,
        channelIssueUpdatedAt: t.channel_issue_updated_at ?? r.channelIssueUpdatedAt,
      } : r)));
    } catch (err) {
      setError(String(err));
      load();
    }
  }

  async function openConversation(row: Row) {
    setModalRow(row);
    setDetail(null);
    setCopied(false);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/chat-detail?id=${encodeURIComponent(row.id)}&propertyId=${encodeURIComponent(row.propertyId)}&type=${row.type}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setDetail(data);
    } catch (err) {
      setDetail({ transcript: `Error loading conversation: ${err}` });
    } finally {
      setDetailLoading(false);
    }
  }

  const agentOptions = Array.from(new Set(rows.map((r) => r.agent).filter(Boolean))).sort();
  const visibleRows = agentFilter ? rows.filter((r) => r.agent === agentFilter) : rows;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as "" | "chat" | "ticket")} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="">All</option>
              <option value="chat">Chat</option>
              <option value="ticket">Ticket</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Property</label>
            <select value={property} onChange={(e) => setProperty(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="">All properties</option>
              {PROPERTIES.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Agent</label>
            <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 max-w-[180px]">
              <option value="">All agents</option>
              {agentOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="name, email, phone, agent" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          <button onClick={load} disabled={loading} className="bg-gray-900 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
            {loading ? "Loading…" : "Load Chats"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-3 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Chats &amp; Tickets — {visibleRows.length}
            {agentFilter && <span className="ml-1 text-sm font-normal text-gray-400">· {agentFilter}</span>}
            <span className="ml-2 text-xs font-normal text-gray-400">click a row to view the conversation</span>
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-white">
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Property</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Channel User</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Email</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Phone</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Created</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Last Seen</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Agent</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Chat Drivers</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Updated</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Channel Issue</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Updated</th>
                <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Type</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r, i) => (
                <tr key={`${r.type}-${r.id}`} onClick={() => openConversation(r)} className={`cursor-pointer hover:bg-blue-50 ${i % 2 === 0 ? "bg-white" : "bg-gray-50"}`}>
                  <td className="px-3 py-2 whitespace-nowrap font-medium">{r.property || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.channelUser || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.email || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.phone || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{fmt(r.createdOn)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600">{fmt(r.lastSeen)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.agent || <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2 align-top">
                    <MultiSelect options={CHAT_DRIVER_OPTIONS} selected={r.drivers} onChange={(v) => saveTags(r, "drivers", v)} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500 text-xs">{fmt(r.driversUpdatedAt)}</td>
                  <td className="px-3 py-2 align-top">
                    <MultiSelect options={CHANNEL_ISSUE_OPTIONS} selected={r.channelIssue} onChange={(v) => saveTags(r, "channelIssue", v)} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500 text-xs">{fmt(r.channelIssueUpdatedAt)}</td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${r.type === "chat" ? "bg-green-100 text-green-700" : "bg-purple-100 text-purple-700"}`}>{r.type}</span>
                  </td>
                </tr>
              ))}
              {visibleRows.length === 0 && !loading && (
                <tr><td colSpan={12} className="text-center py-12 text-gray-400">No chats/tickets — pick a date and click Load (data appears after a sync).</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Conversation modal */}
      {modalRow && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setModalRow(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{modalRow.channelUser || modalRow.email || "Conversation"}</h3>
                <p className="text-xs text-gray-500">
                  {modalRow.property} · {modalRow.type} · {fmt(modalRow.createdOn)}
                  {modalRow.agent ? <> · Agent: <span className="font-medium text-gray-700">{modalRow.agent}</span></> : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { if (detail?.transcript) { navigator.clipboard.writeText(detail.transcript); setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
                  className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-50"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button onClick={() => setModalRow(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
              </div>
            </div>
            {/* Review tags — select drivers & issues right here */}
            {(() => {
              const lr = rows.find((r) => r.id === modalRow.id) ?? modalRow;
              return (
                <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Chat Drivers{lr.driversUpdatedAt ? <span className="text-gray-400 font-normal"> · updated {fmt(lr.driversUpdatedAt)}</span> : null}
                    </label>
                    <MultiSelect options={CHAT_DRIVER_OPTIONS} selected={lr.drivers} onChange={(v) => saveTags(lr, "drivers", v)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Channel Issue{lr.channelIssueUpdatedAt ? <span className="text-gray-400 font-normal"> · updated {fmt(lr.channelIssueUpdatedAt)}</span> : null}
                    </label>
                    <MultiSelect options={CHANNEL_ISSUE_OPTIONS} selected={lr.channelIssue} onChange={(v) => saveTags(lr, "channelIssue", v)} />
                  </div>
                </div>
              );
            })()}

            <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
              {detailLoading ? (
                <p className="text-sm text-gray-400">Loading conversation…</p>
              ) : detail?.type === "ticket" || detail?.subject !== undefined ? (
                <div className="space-y-2 text-sm">
                  {detail?.subject ? <p className="font-semibold">{detail.subject}</p> : null}
                  <p className="whitespace-pre-wrap text-gray-700">{detail?.message || detail?.transcript || "No content."}</p>
                </div>
              ) : detail?.messages && detail.messages.length > 0 ? (
                <div className="space-y-3">
                  {detail.messages.map((m, idx) => (
                    <div key={idx} className={`flex ${m.senderType === "a" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.senderType === "a" ? "bg-blue-600 text-white" : m.senderType === "v" ? "bg-gray-100 text-gray-900" : "bg-amber-50 text-amber-800 text-xs italic"}`}>
                        <div className={`text-[10px] mb-0.5 ${m.senderType === "a" ? "text-blue-100" : "text-gray-400"}`}>{m.sender}{m.time ? ` · ${fmt(m.time)}` : ""}</div>
                        {m.text}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No messages found for this conversation.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
