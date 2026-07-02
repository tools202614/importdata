"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Account { id: string; username: string; role: string; agent_name: string | null; active: boolean }
type Profile = Record<string, string | null>;

const SECTIONS: { title: string; fields: [string, string][] }[] = [
  {
    title: "Identity",
    fields: [
      ["last_name", "Last Name"],
      ["first_name", "First Name"],
      ["middle_name", "Middle Name"],
      ["signal_nickname", "Signal Nickname"],
    ],
  },
  {
    title: "Contact Information",
    fields: [
      ["mobile_number", "Mobile Number"],
      ["carepack_email", "Carepack Email"],
      ["getva_email", "GetVA Email"],
      ["home_address", "Home Address"],
      ["emergency_contact", "Emergency Contact Number"],
    ],
  },
  {
    title: "Employment Details",
    fields: [
      ["employee_id", "Employee ID"],
      ["position", "Position/Job Title"],
      ["department", "Department/Team"],
      ["wisetags", "Wisetags"],
    ],
  },
];
const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields.map(([k]) => k));

export default function ProfileCard({ userId, editable = false }: { userId?: string; editable?: boolean }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [form, setForm] = useState<Profile>({});
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
      const res = await fetch(`/api/profile${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setAccount(data.user);
      const p: Profile = data.profile ?? {};
      const next: Profile = {};
      for (const f of ALL_FIELDS) next[f] = p[f] ?? "";
      setForm(next);
      setPhotoUrl(p.photo_url ?? null);
      setCanEdit(!!data.canEdit);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const isEditable = editable && canEdit;

  async function save() {
    if (!account) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id, ...form }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhoto(file: File) {
    if (!account) return;
    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("userId", account.id);
      fd.append("file", file);
      const res = await fetch("/api/profile/photo", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setPhotoUrl(data.photoUrl);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setUploading(false);
    }
  }

  if (loading) return <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 text-sm text-gray-400">Loading profile…</div>;
  if (!account) return <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6 text-sm text-red-600">{error || "Profile not found."}</div>;

  const fullName = [form.last_name, form.first_name, form.middle_name].filter(Boolean).join(", ") || account.username;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      {/* Header: photo + name */}
      <div className="flex items-center gap-4 px-6 py-5 border-b border-gray-200">
        <div className="relative">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="Profile" className="w-20 h-20 rounded-full object-cover border border-gray-200" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-2xl font-semibold">
              {(form.first_name || account.username || "?").charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900 truncate">{fullName}</h2>
          <p className="text-sm text-gray-500">
            @{account.username}
            <span className="ml-2 inline-block px-1.5 py-0.5 rounded text-[11px] bg-gray-100 text-gray-600">{account.role}</span>
          </p>
          {isEditable && (
            <div className="mt-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="text-xs border border-gray-300 rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
              >
                {uploading ? "Uploading…" : "Change photo"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Fields */}
      <div className="px-6 py-5 space-y-6">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{section.title}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {section.fields.map(([key, label]) => (
                <div key={key} className={key === "home_address" ? "sm:col-span-2" : ""}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  {isEditable ? (
                    key === "home_address" ? (
                      <textarea
                        value={form[key] ?? ""}
                        onChange={(e) => setForm((s) => ({ ...s, [key]: e.target.value }))}
                        rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    ) : (
                      <input
                        value={form[key] ?? ""}
                        onChange={(e) => setForm((s) => ({ ...s, [key]: e.target.value }))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    )
                  ) : (
                    <p className="text-sm text-gray-900 min-h-[20px]">{form[key] || <span className="text-gray-300">—</span>}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {isEditable && (
          <div className="flex items-center gap-3 pt-2">
            <button onClick={save} disabled={saving} className="bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
              {saving ? "Saving…" : "Save profile"}
            </button>
            {saved && <span className="text-sm text-green-600">Saved ✓</span>}
          </div>
        )}
      </div>
    </div>
  );
}
