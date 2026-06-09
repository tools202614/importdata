// ─────────────────────────────────────────────────────────────────────────
// Persistence for escalation records — dual backend.
//
//   • Supabase configured → `escalations` table in Supabase  (production)
//   • not configured      → local JSON file under web/data/   (local dev only)
//
// Same interface either way, so the API route and UI don't care which is active.
// ─────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { SUPABASE_CONFIGURED, getSupabase } from "./supabase";
import {
  EscalationRecord,
  FormDef,
  getForm,
  sanitizeRecordData,
  validatePartialData,
  validateRecordData,
} from "./escalations";

export interface ListFilters {
  formId?: string;
  property?: string;
  status?: string;
  /** Issue/driver category (compared against the form's driver field). */
  driver?: string;
  /** YYYY-MM-DD inclusive lower bound (compared against the form's date field). */
  from?: string;
  /** YYYY-MM-DD inclusive upper bound. */
  to?: string;
  /** Free-text search across all field values. */
  q?: string;
}

// ─── Shared filtering (uses each form's schema metadata) ────────────────────
function recordDate(record: EscalationRecord, form: FormDef | undefined): string {
  if (form?.dateKey) {
    const v = record.data[form.dateKey];
    if (v) return v.slice(0, 10);
  }
  return record.createdAt.slice(0, 10);
}

function applyFilters(all: EscalationRecord[], filters: ListFilters): EscalationRecord[] {
  const q = filters.q?.trim().toLowerCase();

  const filtered = all.filter((r) => {
    const form = getForm(r.formId);
    if (filters.formId && r.formId !== filters.formId) return false;

    if (filters.property) {
      const propKey = form?.propertyKey;
      if (!propKey || r.data[propKey] !== filters.property) return false;
    }
    if (filters.status) {
      const statusKey = form?.statusKey;
      if (!statusKey || r.data[statusKey] !== filters.status) return false;
    }
    if (filters.driver) {
      const driverKey = form?.driverKey;
      if (!driverKey || r.data[driverKey] !== filters.driver) return false;
    }
    if (filters.from || filters.to) {
      const d = recordDate(r, form);
      if (filters.from && d < filters.from) return false;
      if (filters.to && d > filters.to) return false;
    }
    if (q) {
      const haystack = Object.values(r.data).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return filtered;
}

// ════════════════════════════════════════════════════════════════════════
// Supabase backend
// ════════════════════════════════════════════════════════════════════════
interface SbRow {
  id: string;
  form_id: string;
  data: Record<string, string>;
  created_at: string;
  updated_at: string;
}

function mapRow(r: SbRow): EscalationRecord {
  return { id: r.id, formId: r.form_id, createdAt: r.created_at, updatedAt: r.updated_at, data: r.data };
}

async function sbList(filters: ListFilters): Promise<EscalationRecord[]> {
  const sb = getSupabase();
  let query = sb.from("escalations").select("*").limit(10000);
  if (filters.formId) query = query.eq("form_id", filters.formId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return applyFilters((data as SbRow[]).map(mapRow), filters);
}

async function sbCreate(formId: string, clean: Record<string, string>): Promise<EscalationRecord> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("escalations")
    .insert({ form_id: formId, data: clean })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data as SbRow);
}

async function sbUpdate(id: string, rawData: Record<string, unknown>): Promise<EscalationRecord> {
  const sb = getSupabase();
  const { data: existing, error: readErr } = await sb
    .from("escalations")
    .select("*")
    .eq("id", id)
    .single();
  if (readErr || !existing) throw new Error(`Record not found: ${id}`);

  const form = getForm((existing as SbRow).form_id);
  if (!form) throw new Error(`Unknown form: ${(existing as SbRow).form_id}`);
  const clean = sanitizeRecordData(form, rawData);
  const errors = validatePartialData(form, clean);
  if (errors.length) throw new Error(errors.join("; "));

  const merged = { ...(existing as SbRow).data, ...clean };
  const { data, error } = await sb
    .from("escalations")
    .update({ data: merged, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data as SbRow);
}

async function sbDelete(id: string): Promise<boolean> {
  const sb = getSupabase();
  const { data, error } = await sb.from("escalations").delete().eq("id", id).select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

// ════════════════════════════════════════════════════════════════════════
// File backend (local dev fallback)
// ════════════════════════════════════════════════════════════════════════
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "escalations.json");

let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

async function fileReadAll(): Promise<EscalationRecord[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as EscalationRecord[]) : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function fileWriteAll(records: EscalationRecord[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(records, null, 2), "utf-8");
  await fs.rename(tmp, DATA_FILE);
}

// ════════════════════════════════════════════════════════════════════════
// Public API (dispatches to the active backend)
// ════════════════════════════════════════════════════════════════════════
export async function listRecords(filters: ListFilters = {}): Promise<EscalationRecord[]> {
  if (SUPABASE_CONFIGURED) return sbList(filters);
  return applyFilters(await fileReadAll(), filters);
}

export async function createRecord(formId: string, data: Record<string, unknown>): Promise<EscalationRecord> {
  const form = getForm(formId);
  if (!form) throw new Error(`Unknown form: ${formId}`);
  const clean = sanitizeRecordData(form, data);
  const errors = validateRecordData(form, clean);
  if (errors.length) throw new Error(errors.join("; "));

  if (SUPABASE_CONFIGURED) return sbCreate(formId, clean);

  return withLock(async () => {
    const all = await fileReadAll();
    const now = new Date().toISOString();
    const record: EscalationRecord = { id: crypto.randomUUID(), formId, createdAt: now, updatedAt: now, data: clean };
    all.push(record);
    await fileWriteAll(all);
    return record;
  });
}

export async function updateRecord(id: string, data: Record<string, unknown>): Promise<EscalationRecord> {
  // sbUpdate re-reads the row to discover its form, then sanitizes/validates the patch.
  if (SUPABASE_CONFIGURED) return sbUpdate(id, data);

  return withLock(async () => {
    const all = await fileReadAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`Record not found: ${id}`);
    const existing = all[idx];
    const form = getForm(existing.formId);
    if (!form) throw new Error(`Unknown form: ${existing.formId}`);
    const clean = sanitizeRecordData(form, data);
    const errors = validatePartialData(form, clean);
    if (errors.length) throw new Error(errors.join("; "));
    const updated: EscalationRecord = {
      ...existing,
      data: { ...existing.data, ...clean },
      updatedAt: new Date().toISOString(),
    };
    all[idx] = updated;
    await fileWriteAll(all);
    return updated;
  });
}

export async function deleteRecord(id: string): Promise<boolean> {
  if (SUPABASE_CONFIGURED) return sbDelete(id);
  return withLock(async () => {
    const all = await fileReadAll();
    const next = all.filter((r) => r.id !== id);
    if (next.length === all.length) return false;
    await fileWriteAll(next);
    return true;
  });
}
