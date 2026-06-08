// ─────────────────────────────────────────────────────────────────────────
// Persistence for escalation records — dual backend.
//
//   • POSTGRES_URL (or DATABASE_URL) set  → Vercel Postgres / Neon  (production)
//   • neither set                          → local JSON file under web/data/
//
// Both backends expose the same interface, so the API route and UI don't care
// which is active. Local dev works with no database; Vercel uses Postgres.
// ─────────────────────────────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createPool, type VercelPool } from "@vercel/postgres";
import {
  EscalationRecord,
  FormDef,
  getForm,
  sanitizeRecordData,
  validatePartialData,
  validateRecordData,
} from "./escalations";

const PG_URL = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
const USE_PG = !!PG_URL;

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

// ─── Shared filtering (backend-agnostic, uses each form's schema metadata) ──
/** The date used for range filtering: the form's date field, else createdAt's day. */
function recordDate(record: EscalationRecord, form: FormDef | undefined): string {
  if (form?.dateKey) {
    const v = record.data[form.dateKey];
    if (v) return v.slice(0, 10);
  }
  return record.createdAt.slice(0, 10);
}

/** Apply property/status/driver/date/search filters, then sort newest-first. */
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
// Postgres backend
// ════════════════════════════════════════════════════════════════════════
let pool: VercelPool | null = null;
function getPool(): VercelPool {
  if (!pool) pool = createPool({ connectionString: PG_URL });
  return pool;
}

let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await getPool().query(`
        CREATE TABLE IF NOT EXISTS escalations (
          id          uuid PRIMARY KEY,
          form_id     text NOT NULL,
          data        jsonb NOT NULL,
          created_at  timestamptz NOT NULL,
          updated_at  timestamptz NOT NULL
        );
      `);
      await getPool().query(`CREATE INDEX IF NOT EXISTS escalations_form_id_idx ON escalations (form_id);`);
      await getPool().query(`CREATE INDEX IF NOT EXISTS escalations_created_at_idx ON escalations (created_at DESC);`);
    })().catch((err) => {
      schemaReady = null; // allow retry on next call
      throw err;
    });
  }
  return schemaReady;
}

interface PgRow {
  id: string;
  form_id: string;
  data: Record<string, string>;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function mapRow(r: PgRow): EscalationRecord {
  return {
    id: r.id,
    formId: r.form_id,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    data: r.data,
  };
}

async function pgList(filters: ListFilters): Promise<EscalationRecord[]> {
  await ensureSchema();
  // Push down form_id (a real column); apply the rest in memory via the shared
  // filter so per-form JSONB field logic stays identical to the file backend.
  const rows = filters.formId
    ? await getPool().query<PgRow>(
        `SELECT id, form_id, data, created_at, updated_at FROM escalations WHERE form_id = $1`,
        [filters.formId]
      )
    : await getPool().query<PgRow>(`SELECT id, form_id, data, created_at, updated_at FROM escalations`);
  return applyFilters(rows.rows.map(mapRow), filters);
}

async function pgCreate(formId: string, clean: Record<string, string>): Promise<EscalationRecord> {
  await ensureSchema();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const res = await getPool().query<PgRow>(
    `INSERT INTO escalations (id, form_id, data, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $4)
     RETURNING id, form_id, data, created_at, updated_at`,
    [id, formId, JSON.stringify(clean), now]
  );
  return mapRow(res.rows[0]);
}

async function pgUpdate(id: string, form: FormDef, clean: Record<string, string>): Promise<EscalationRecord> {
  await ensureSchema();
  // Atomic JSONB merge — concurrent edits to different fields don't clobber.
  const res = await getPool().query<PgRow>(
    `UPDATE escalations
     SET data = data || $2::jsonb, updated_at = $3
     WHERE id = $1
     RETURNING id, form_id, data, created_at, updated_at`,
    [id, JSON.stringify(clean), new Date().toISOString()]
  );
  if (res.rowCount === 0) throw new Error(`Record not found: ${id}`);
  void form;
  return mapRow(res.rows[0]);
}

async function pgFormIdOf(id: string): Promise<string | null> {
  await ensureSchema();
  const res = await getPool().query<{ form_id: string }>(`SELECT form_id FROM escalations WHERE id = $1`, [id]);
  return res.rows[0]?.form_id ?? null;
}

async function pgDelete(id: string): Promise<boolean> {
  await ensureSchema();
  const res = await getPool().query(`DELETE FROM escalations WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

// ════════════════════════════════════════════════════════════════════════
// File backend (local dev fallback)
// ════════════════════════════════════════════════════════════════════════
const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "escalations.json");

// Serialize writes so concurrent requests can't clobber each other.
let writeChain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn, fn);
  writeChain = next.then(
    () => undefined,
    () => undefined
  );
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
  if (USE_PG) return pgList(filters);
  return applyFilters(await fileReadAll(), filters);
}

export async function createRecord(
  formId: string,
  data: Record<string, unknown>
): Promise<EscalationRecord> {
  const form = getForm(formId);
  if (!form) throw new Error(`Unknown form: ${formId}`);

  const clean = sanitizeRecordData(form, data);
  const errors = validateRecordData(form, clean);
  if (errors.length) throw new Error(errors.join("; "));

  if (USE_PG) return pgCreate(formId, clean);

  return withLock(async () => {
    const all = await fileReadAll();
    const now = new Date().toISOString();
    const record: EscalationRecord = { id: crypto.randomUUID(), formId, createdAt: now, updatedAt: now, data: clean };
    all.push(record);
    await fileWriteAll(all);
    return record;
  });
}

export async function updateRecord(
  id: string,
  data: Record<string, unknown>
): Promise<EscalationRecord> {
  if (USE_PG) {
    const formId = await pgFormIdOf(id);
    if (!formId) throw new Error(`Record not found: ${id}`);
    const form = getForm(formId);
    if (!form) throw new Error(`Unknown form: ${formId}`);
    const clean = sanitizeRecordData(form, data);
    const errors = validatePartialData(form, clean);
    if (errors.length) throw new Error(errors.join("; "));
    return pgUpdate(id, form, clean);
  }

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
  if (USE_PG) return pgDelete(id);

  return withLock(async () => {
    const all = await fileReadAll();
    const next = all.filter((r) => r.id !== id);
    if (next.length === all.length) return false;
    await fileWriteAll(next);
    return true;
  });
}
