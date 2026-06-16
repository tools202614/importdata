"use client";

import { useCallback, useEffect, useState } from "react";
import { getForm, EscalationRecord, FieldDef } from "@/lib/escalations";
import { PROPERTIES } from "@/lib/properties";

const CHARGEBACK = getForm("chargeback")!;
const CB_STATUS = CHARGEBACK.fields.find((f) => f.key === "status")?.options ?? [];

// ─── shared helpers ──────────────────────────────────
function escapeCSV(v: string | number) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (["done", "won"].includes(s)) return "text-green-700 bg-green-100";
  if (["pending"].includes(s)) return "text-blue-700 bg-blue-100";
  if (["lost/settled", "deadline missed"].includes(s)) return "text-red-700 bg-red-100";
  return "text-gray-700 bg-gray-100";
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const fmtPct = (n: number) => `${n.toFixed(2)}%`;
const today = () => new Date().toISOString().slice(0, 10);

// ═══════════════════════════════════════════════════════════════════════
export default function EscalationsPanel() {
  const [view, setView] = useState<"drivers" | "chargeback">("drivers");
  const tab = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
      active ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setView("drivers")} className={tab(view === "drivers")}>Chat Drivers</button>
        <button onClick={() => setView("chargeback")} className={tab(view === "chargeback")}>Chargeback</button>
      </div>
      {view === "drivers" ? <ChatDriversView /> : <ChargebackView />}
    </div>
  );
}

// ─── Chat Drivers (read-only, auto from per-chat tagging) ────────────────
function ChatDriversView() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [property, setProperty] = useState("");
  const [rows, setRows] = useState<{ driver: string; count: number; pct: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setFrom(today()); setTo(today()); }, []);

  async function load() {
    if (!from || !to) return;
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams({ from, to });
      if (property) p.set("property", property);
      const res = await fetch(`/api/chat-driver-summary?${p}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setRows(data.rows); setTotal(data.total);
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  }

  function downloadCsv() {
    const lines = [["Common Issue", "Total Cases", "Percentage"].join(",")];
    for (const r of rows) lines.push([escapeCSV(r.driver), r.count, fmtPct(r.pct)].join(","));
    lines.push(["TOTAL", total, "100.00%"].join(","));
    downloadCSV(`chat_drivers_${from}_to_${to}.csv`, lines.join("\n"));
  }

  return (
    <div className="space-y-4">
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Property</label>
            <select value={property} onChange={(e) => setProperty(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="">All properties</option>
              {PROPERTIES.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <button onClick={load} disabled={loading} className="bg-gray-900 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
            {loading ? "Loading…" : "Generate"}
          </button>
          {rows.length > 0 && (
            <>
              <div className="flex-1" />
              <button onClick={downloadCsv} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">Download CSV</button>
            </>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <p className="mt-2 text-xs text-gray-400">Counts come from the Chat Drivers tagged per chat on the Chats page — no manual entry here.</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="px-6 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Chat Drivers — {rows.length}</h3>
        </div>
        {rows.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{loading ? "Loading…" : "Generate to see driver counts (tag chats on the Chats page first)."}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-900 text-white">
                <th className="px-4 py-2 text-left font-medium">Common Issue</th>
                <th className="px-4 py-2 text-right font-medium">Total Cases</th>
                <th className="px-4 py-2 text-right font-medium">Percentage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.driver} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-4 py-2">{r.driver}</td>
                  <td className="px-4 py-2 text-right font-mono">{r.count}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmtPct(r.pct)}</td>
                </tr>
              ))}
              <tr className="bg-gray-100 font-bold border-t-2 border-gray-300">
                <td className="px-4 py-2">TOTAL</td>
                <td className="px-4 py-2 text-right font-mono">{total}</td>
                <td className="px-4 py-2 text-right font-mono">100.00%</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Chargeback (manual CRUD) ────────────────────────────────────────────
function ChargebackView() {
  const [records, setRecords] = useState<EscalationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fProperty, setFProperty] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fQuery, setFQuery] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const propertyOptions = CHARGEBACK.fields.find((f) => f.key === "property")?.options ?? [];

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams({ formId: "chargeback" });
      if (fProperty) p.set("property", fProperty);
      if (fStatus) p.set("status", fStatus);
      if (fQuery) p.set("q", fQuery);
      const res = await fetch(`/api/escalations?${p}`);
      if (!res.ok) throw new Error(await res.text());
      setRecords((await res.json()).rows);
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  }, [fProperty, fStatus, fQuery]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    const d: Record<string, string> = {};
    for (const f of CHARGEBACK.fields) d[f.key] = "";
    setFormData(d); setEditingId(null); setFormError(""); setModalOpen(true);
  }
  function openEdit(r: EscalationRecord) {
    setFormData({ ...r.data }); setEditingId(r.id); setFormError(""); setModalOpen(true);
  }
  async function save() {
    setSaving(true); setFormError("");
    try {
      const res = editingId
        ? await fetch("/api/escalations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingId, data: formData }) })
        : await fetch("/api/escalations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ formId: "chargeback", data: formData }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setModalOpen(false); await load();
    } catch (err) { setFormError(String(err instanceof Error ? err.message : err)); } finally { setSaving(false); }
  }
  async function updateStatus(r: EscalationRecord, value: string) {
    setRecords((prev) => prev.map((x) => (x.id === r.id ? { ...x, data: { ...x.data, status: value } } : x)));
    try {
      const res = await fetch("/api/escalations", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, data: { status: value } }) });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) { setError(String(err)); load(); }
  }
  async function remove(id: string) {
    if (!confirm("Delete this chargeback record?")) return;
    try {
      const res = await fetch(`/api/escalations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (err) { setError(String(err)); }
  }
  function downloadCsv() {
    const cols = CHARGEBACK.fields;
    const lines = [[...cols.map((c) => c.label), "Created"].map(escapeCSV).join(",")];
    for (const r of records) lines.push([...cols.map((c) => escapeCSV(r.data[c.key] ?? "")), escapeCSV(fmtDate(r.createdAt))].join(","));
    downloadCSV(`chargebacks_${today()}.csv`, lines.join("\n"));
  }

  const hasFilters = !!(fProperty || fStatus || fQuery);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Property</label>
            <select value={fProperty} onChange={(e) => setFProperty(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="">All properties</option>
              {propertyOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
              <option value="">All statuses</option>
              {CB_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input type="text" value={fQuery} onChange={(e) => setFQuery(e.target.value)} placeholder="name, email, reason…" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
          {hasFilters && <button onClick={() => { setFProperty(""); setFStatus(""); setFQuery(""); }} className="text-sm text-gray-500 hover:text-gray-700 underline pb-2">Clear</button>}
          <button onClick={openCreate} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">+ New Record</button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Chargeback — {records.length}{loading && <span className="ml-2 text-sm font-normal text-gray-400">loading…</span>}</h3>
          {records.length > 0 && <button onClick={downloadCsv} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">Download CSV</button>}
        </div>
        {records.length === 0 ? (
          <div className="text-center py-12 text-gray-400">{loading ? "Loading…" : "No chargebacks. Click “New Record”."}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-900 text-white">
                  {CHARGEBACK.fields.map((f) => <th key={f.key} className="px-3 py-2 text-left font-medium whitespace-nowrap">{f.label}</th>)}
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    {CHARGEBACK.fields.map((f) => (
                      <td key={f.key} className="px-3 py-2 align-top">
                        {f.key === "status" ? (
                          <select value={r.data.status ?? ""} onChange={(e) => updateStatus(r, e.target.value)} className={`rounded px-2 py-1 text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-900 ${statusClass(r.data.status ?? "")}`}>
                            {CB_STATUS.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : f.type === "textarea" ? (
                          <span className="block max-w-xs truncate" title={r.data[f.key] ?? ""}>{r.data[f.key] || <span className="text-gray-300">—</span>}</span>
                        ) : (
                          <span className="whitespace-nowrap">{r.data[f.key] || <span className="text-gray-300">—</span>}</span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(r)} className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-2">Edit</button>
                      <button onClick={() => remove(r.id)} className="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">{editingId ? "Edit" : "New"} Chargeback</h3>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {CHARGEBACK.fields.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{field.label}{field.required && <span className="text-red-500 ml-0.5">*</span>}</label>
                  <FieldInput field={field} value={formData[field.key] ?? ""} onChange={(v) => setFormData({ ...formData, [field.key]: v })} />
                </div>
              ))}
              {formError && <p className="text-sm text-red-600">{formError}</p>}
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="px-5 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">{saving ? "Saving…" : editingId ? "Save Changes" : "Create Record"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldInput({ field, value, onChange }: { field: FieldDef; value: string; onChange: (v: string) => void }) {
  const base = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900";
  if (field.type === "select") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">— Select —</option>
        {field.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (field.type === "textarea") return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={base} />;
  const t = field.type === "number" ? "number" : field.type === "email" ? "email" : field.type === "date" ? "date" : "text";
  return <input type={t} value={value} onChange={(e) => onChange(e.target.value)} className={base} />;
}
