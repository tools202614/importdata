"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ESCALATION_FORMS,
  EscalationRecord,
  FieldDef,
  FormDef,
  getForm,
} from "@/lib/escalations";

// ─── CSV helpers ─────────────────────────────────────
function escapeCSV(val: string | number) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCSV(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Status colour coding ────────────────────────────
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (["resolved", "done", "won", "fixed", "working"].includes(s)) return "text-green-700 bg-green-100";
  if (["open", "pending", "reported/pending"].includes(s)) return "text-blue-700 bg-blue-100";
  if (["in progress"].includes(s)) return "text-orange-700 bg-orange-100";
  if (["lost/settled", "deadline missed", "flagged", "error on flagged/reported to dookie"].includes(s))
    return "text-red-700 bg-red-100";
  return "text-gray-700 bg-gray-100";
}

const ALL = "all" as const;

// Union of every status option across all forms (for the "All" filter dropdown).
const ALL_STATUS_OPTIONS = Array.from(
  new Set(
    ESCALATION_FORMS.flatMap((f) =>
      f.statusKey ? f.fields.find((x) => x.key === f.statusKey)?.options ?? [] : []
    )
  )
);

// Union of every property option across all forms.
const ALL_PROPERTY_OPTIONS = Array.from(
  new Set(
    ESCALATION_FORMS.flatMap((f) =>
      f.propertyKey ? f.fields.find((x) => x.key === f.propertyKey)?.options ?? [] : []
    )
  )
);

// Union of every issue/driver option across all forms.
const ALL_DRIVER_OPTIONS = Array.from(
  new Set(
    ESCALATION_FORMS.flatMap((f) =>
      f.driverKey ? f.fields.find((x) => x.key === f.driverKey)?.options ?? [] : []
    )
  )
);

export default function EscalationsPanel() {
  const [activeFormId, setActiveFormId] = useState<string>(ESCALATION_FORMS[0].id);
  const [records, setRecords] = useState<EscalationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Filters
  const [fProperty, setFProperty] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDriver, setFDriver] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fQuery, setFQuery] = useState("");

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modalFormId, setModalFormId] = useState(ESCALATION_FORMS[0].id);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const activeForm = activeFormId === ALL ? null : getForm(activeFormId);

  // Property / status dropdown options depend on the active view.
  const propertyOptions = activeForm
    ? activeForm.fields.find((f) => f.key === activeForm.propertyKey)?.options ?? []
    : ALL_PROPERTY_OPTIONS;
  const statusOptions = activeForm
    ? activeForm.fields.find((f) => f.key === activeForm.statusKey)?.options ?? []
    : ALL_STATUS_OPTIONS;
  const driverOptions = activeForm
    ? activeForm.fields.find((f) => f.key === activeForm.driverKey)?.options ?? []
    : ALL_DRIVER_OPTIONS;

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (activeFormId !== ALL) params.set("formId", activeFormId);
      if (fProperty) params.set("property", fProperty);
      if (fStatus) params.set("status", fStatus);
      if (fDriver) params.set("driver", fDriver);
      if (fFrom) params.set("from", fFrom);
      if (fTo) params.set("to", fTo);
      if (fQuery) params.set("q", fQuery);
      const res = await fetch(`/api/escalations?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRecords(data.rows);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [activeFormId, fProperty, fStatus, fDriver, fFrom, fTo, fQuery]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // Reset property/status filters when they no longer apply to the active view.
  useEffect(() => {
    if (fProperty && !propertyOptions.includes(fProperty)) setFProperty("");
    if (fStatus && !statusOptions.includes(fStatus)) setFStatus("");
    if (fDriver && !driverOptions.includes(fDriver)) setFDriver("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFormId]);

  // ─── Modal handlers ────────────────────────────────
  function openCreate() {
    const fid = activeFormId === ALL ? ESCALATION_FORMS[0].id : activeFormId;
    setModalFormId(fid);
    setEditingId(null);
    setFormData(defaultFormData(getForm(fid)!));
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(record: EscalationRecord) {
    setModalFormId(record.formId);
    setEditingId(record.id);
    setFormData({ ...record.data });
    setFormError("");
    setModalOpen(true);
  }

  function changeModalForm(fid: string) {
    setModalFormId(fid);
    setFormData(defaultFormData(getForm(fid)!));
  }

  async function saveRecord() {
    setSaving(true);
    setFormError("");
    try {
      const res = editingId
        ? await fetch("/api/escalations", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: editingId, data: formData }),
          })
        : await fetch("/api/escalations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ formId: modalFormId, data: formData }),
          });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setModalOpen(false);
      await loadRecords();
    } catch (err) {
      setFormError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(record: EscalationRecord, statusKey: string, value: string) {
    // Optimistic update
    setRecords((prev) =>
      prev.map((r) => (r.id === record.id ? { ...r, data: { ...r.data, [statusKey]: value } } : r))
    );
    try {
      const res = await fetch("/api/escalations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id, data: { [statusKey]: value } }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      setError(String(err));
      await loadRecords(); // revert to server truth
    }
  }

  async function removeRecord(id: string) {
    if (!confirm("Delete this record? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/escalations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      await loadRecords();
    } catch (err) {
      setError(String(err));
    }
  }

  // ─── CSV ───────────────────────────────────────────
  function downloadReport() {
    if (activeForm) {
      const cols = activeForm.fields;
      const header = [...cols.map((c) => c.label), "Created"];
      const lines = [header.map(escapeCSV).join(",")];
      for (const r of records) {
        lines.push(
          [...cols.map((c) => escapeCSV(r.data[c.key] ?? "")), escapeCSV(fmtDateTime(r.createdAt))].join(",")
        );
      }
      downloadCSV(`${activeForm.id}_${todayStr()}.csv`, lines.join("\n"));
    } else {
      const header = ["Form", "Date", "Property", "Status", "Summary", "Created"];
      const lines = [header.map(escapeCSV).join(",")];
      for (const r of records) {
        const f = getForm(r.formId);
        lines.push(
          [
            escapeCSV(f?.title ?? r.formId),
            escapeCSV(genericDate(r, f)),
            escapeCSV(genericProperty(r, f)),
            escapeCSV(genericStatus(r, f)),
            escapeCSV(genericSummary(r, f)),
            escapeCSV(fmtDateTime(r.createdAt)),
          ].join(",")
        );
      }
      downloadCSV(`escalations_all_${todayStr()}.csv`, lines.join("\n"));
    }
  }

  const hasActiveFilters = !!(fProperty || fStatus || fDriver || fFrom || fTo || fQuery);

  // ─── Render ────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Form-type selector */}
      <div className="flex flex-wrap items-center gap-2">
        {ESCALATION_FORMS.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFormId(f.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              activeFormId === f.id
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {f.title}
            {f.draft && <span className="ml-1.5 text-[10px] uppercase opacity-70">draft</span>}
          </button>
        ))}
        <button
          onClick={() => setActiveFormId(ALL)}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
            activeFormId === ALL
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          All Escalations
        </button>
        <div className="flex-1" />
        <button
          onClick={openCreate}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + New Record
        </button>
      </div>

      {activeForm?.draft && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2">
          The <strong>{activeForm.title}</strong> fields are a draft default — send the real field list to finalize them.
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Property</label>
            <select
              value={fProperty}
              onChange={(e) => setFProperty(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 min-w-[160px]"
            >
              <option value="">All properties</option>
              {propertyOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 min-w-[140px]"
            >
              <option value="">All statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          {driverOptions.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Issue / Driver</label>
              <select
                value={fDriver}
                onChange={(e) => setFDriver(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 max-w-[200px]"
              >
                <option value="">All issues</option>
                {driverOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={fFrom}
              onChange={(e) => setFFrom(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input
              type="date"
              value={fTo}
              onChange={(e) => setFTo(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input
              type="text"
              value={fQuery}
              onChange={(e) => setFQuery(e.target.value)}
              placeholder="Search any field…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>
          {hasActiveFilters && (
            <button
              onClick={() => {
                setFProperty("");
                setFStatus("");
                setFDriver("");
                setFFrom("");
                setFTo("");
                setFQuery("");
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline pb-2"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {activeForm ? activeForm.title : "All Escalations"} — {records.length} record
            {records.length === 1 ? "" : "s"}
            {loading && <span className="ml-2 text-sm font-normal text-gray-400">loading…</span>}
          </h2>
          {records.length > 0 && (
            <button
              onClick={downloadReport}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
            >
              Download CSV
            </button>
          )}
        </div>

        {records.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            {loading ? "Loading…" : hasActiveFilters ? "No records match the filters." : "No records yet. Click “New Record” to add one."}
          </div>
        ) : activeForm ? (
          <FormTable form={activeForm} records={records} onStatus={updateStatus} onEdit={openEdit} onDelete={removeRecord} />
        ) : (
          <AllTable records={records} onEdit={openEdit} onDelete={removeRecord} />
        )}
      </div>

      {/* Create / Edit modal */}
      {modalOpen && (
        <RecordModal
          formId={modalFormId}
          editing={!!editingId}
          formData={formData}
          setFormData={setFormData}
          onChangeForm={changeModalForm}
          onClose={() => setModalOpen(false)}
          onSave={saveRecord}
          saving={saving}
          error={formError}
        />
      )}
    </div>
  );
}

// ─── Per-form table ──────────────────────────────────
function FormTable({
  form,
  records,
  onStatus,
  onEdit,
  onDelete,
}: {
  form: FormDef;
  records: EscalationRecord[];
  onStatus: (r: EscalationRecord, key: string, value: string) => void;
  onEdit: (r: EscalationRecord) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-900 text-white">
            {form.fields.map((f) => (
              <th key={f.key} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                {f.label}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={r.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
              {form.fields.map((f) => (
                <td key={f.key} className="px-3 py-2 align-top">
                  {f.key === form.statusKey ? (
                    <StatusCell field={f} value={r.data[f.key] ?? ""} onChange={(v) => onStatus(r, f.key, v)} />
                  ) : (
                    <CellValue field={f} value={r.data[f.key] ?? ""} />
                  )}
                </td>
              ))}
              <td className="px-3 py-2 text-right whitespace-nowrap">
                <RowActions record={r} onEdit={onEdit} onDelete={onDelete} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── "All escalations" combined table ────────────────
function AllTable({
  records,
  onEdit,
  onDelete,
}: {
  records: EscalationRecord[];
  onEdit: (r: EscalationRecord) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-900 text-white">
            <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Issue Type</th>
            <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Date</th>
            <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Property</th>
            <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Status</th>
            <th className="px-3 py-2 text-left font-medium">Summary</th>
            <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Created</th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => {
            const f = getForm(r.formId);
            const status = genericStatus(r, f);
            return (
              <tr key={r.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                <td className="px-3 py-2 whitespace-nowrap font-medium">{f?.title ?? r.formId}</td>
                <td className="px-3 py-2 whitespace-nowrap">{genericDate(r, f) || <Dash />}</td>
                <td className="px-3 py-2 whitespace-nowrap">{genericProperty(r, f) || <Dash />}</td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  {status ? (
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusClass(status)}`}>
                      {status}
                    </span>
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="px-3 py-2 max-w-md truncate" title={genericSummary(r, f)}>
                  {genericSummary(r, f) || <Dash />}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-gray-500">{fmtDateTime(r.createdAt)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <RowActions record={r} onEdit={onEdit} onDelete={onDelete} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({
  record,
  onEdit,
  onDelete,
}: {
  record: EscalationRecord;
  onEdit: (r: EscalationRecord) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <span className="inline-flex gap-2">
      <button onClick={() => onEdit(record)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">
        Edit
      </button>
      <button onClick={() => onDelete(record.id)} className="text-red-500 hover:text-red-700 text-xs font-medium">
        Delete
      </button>
    </span>
  );
}

function StatusCell({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded px-2 py-1 text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-900 ${statusClass(value)}`}
    >
      {field.options?.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function CellValue({ field, value }: { field: FieldDef; value: string }) {
  if (!value) return <Dash />;
  if (field.type === "textarea") {
    return <span className="block max-w-xs truncate" title={value}>{value}</span>;
  }
  if (field.type === "number") {
    return <span className="font-mono">{value}</span>;
  }
  if (field.type === "email") {
    return <span className="whitespace-nowrap">{value}</span>;
  }
  return <span className="whitespace-nowrap">{value}</span>;
}

function Dash() {
  return <span className="text-gray-300">—</span>;
}

// ─── Create / Edit modal ─────────────────────────────
function RecordModal({
  formId,
  editing,
  formData,
  setFormData,
  onChangeForm,
  onClose,
  onSave,
  saving,
  error,
}: {
  formId: string;
  editing: boolean;
  formData: Record<string, string>;
  setFormData: (d: Record<string, string>) => void;
  onChangeForm: (fid: string) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  error: string;
}) {
  const form = getForm(formId)!;

  function setField(key: string, value: string) {
    setFormData({ ...formData, [key]: value });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            {editing ? "Edit" : "New"} {form.title}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Form type chooser only when creating */}
          {!editing && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Form Type</label>
              <select
                value={formId}
                onChange={(e) => onChangeForm(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              >
                {ESCALATION_FORMS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {field.label}
                {field.required && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <FieldInput field={field} value={formData[field.key] ?? ""} onChange={(v) => setField(field.key, v)} />
            </div>
          ))}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : editing ? "Save Changes" : "Create Record"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const base =
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900";

  if (field.type === "select") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">— Select —</option>
        {field.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "textarea") {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={base} />;
  }
  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : "text";
  return <input type={inputType} value={value} onChange={(e) => onChange(e.target.value)} className={base} />;
}

// ─── Helpers ─────────────────────────────────────────
function defaultFormData(form: FormDef): Record<string, string> {
  const d: Record<string, string> = {};
  for (const f of form.fields) d[f.key] = "";
  return d;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function genericStatus(r: EscalationRecord, f: FormDef | undefined): string {
  return f?.statusKey ? r.data[f.statusKey] ?? "" : "";
}
function genericProperty(r: EscalationRecord, f: FormDef | undefined): string {
  return f?.propertyKey ? r.data[f.propertyKey] ?? "" : "";
}
function genericDate(r: EscalationRecord, f: FormDef | undefined): string {
  if (f?.dateKey && r.data[f.dateKey]) return r.data[f.dateKey];
  return "";
}
function genericSummary(r: EscalationRecord, f: FormDef | undefined): string {
  if (!f) return "";
  // First non-empty text-ish field that isn't status/property/date.
  const skip = new Set([f.statusKey, f.propertyKey, f.dateKey]);
  for (const field of f.fields) {
    if (skip.has(field.key)) continue;
    const v = r.data[field.key];
    if (v) return `${field.label}: ${v}`;
  }
  return "";
}
