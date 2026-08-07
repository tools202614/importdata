// ─────────────────────────────────────────────────────────────────────────
// Escalation forms — schema-driven definitions.
//
// tawk.to has no API to store custom escalation records (no ticket.create /
// custom-record write endpoints), so these forms persist in our own store.
// Each form is described declaratively here; the UI and the API both render /
// validate from these definitions. To add or change a form, edit this file —
// nothing else needs to change.
// ─────────────────────────────────────────────────────────────────────────

import { PROPERTIES } from "./properties";

export type FieldType = "text" | "email" | "number" | "date" | "textarea" | "select";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[]; // for select fields
  required?: boolean;
}

export interface FormDef {
  id: string;
  title: string;
  fields: FieldDef[];
  /** Field key holding the workflow status (used for filtering + colour coding). */
  statusKey?: string;
  /** Field key used for date-range filtering. Falls back to createdAt when absent. */
  dateKey?: string;
  /** Field key holding the property name (used for the property filter). */
  propertyKey?: string;
  /** Field key holding the issue/driver category (used for the driver filter). */
  driverKey?: string;
  /** Whether this form's fields are confirmed by the business (false = draft). */
  draft?: boolean;
}

const PROPERTY_OPTIONS = PROPERTIES.map((p) => p.name);

// ─── Chargeback ──────────────────────────────────────────────────────────
// Simplified to the important fields (per request). Chat Drivers are no longer a
// form — they're tagged per-chat on the Chats page (chat_tags.drivers).
const CHARGEBACK: FormDef = {
  id: "chargeback",
  title: "Chargeback",
  statusKey: "status",
  propertyKey: "property",
  fields: [
    { key: "property", label: "Property", type: "select", options: PROPERTY_OPTIONS, required: true },
    { key: "customerName", label: "Customer Name", type: "text", required: true },
    { key: "email", label: "Email Address", type: "email" },
    { key: "amount", label: "Amount", type: "number" },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["Pending", "Done", "Lost/Settled", "Won", "Deadline Missed"],
      required: true,
    },
    { key: "reason", label: "Reason", type: "textarea" },
  ],
};

// ─── Refund ──────────────────────────────────────────────────────────────
// Mirrors Chargeback with refund-appropriate statuses. (Fields were never
// formally specced — adjust here if the real Refund form differs.)
const REFUND: FormDef = {
  id: "refund",
  title: "Refund",
  statusKey: "status",
  propertyKey: "property",
  fields: [
    { key: "property", label: "Property", type: "select", options: PROPERTY_OPTIONS, required: true },
    { key: "customerName", label: "Customer Name", type: "text", required: true },
    { key: "email", label: "Email Address", type: "email" },
    { key: "amount", label: "Amount", type: "number" },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: ["Pending", "Approved", "Processed", "Denied", "Done"],
      required: true,
    },
    { key: "reason", label: "Reason", type: "textarea" },
  ],
};

export const ESCALATION_FORMS: FormDef[] = [CHARGEBACK, REFUND];

export function getForm(formId: string): FormDef | undefined {
  return ESCALATION_FORMS.find((f) => f.id === formId);
}

// ─── Stored record shape ───────────────────────────────────────────────────
export interface EscalationRecord {
  id: string;
  formId: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  data: Record<string, string>;
  createdBy?: string | null; // account username that created it
  agentName?: string | null; // creator's display/agent name
}

/** Validate a submitted data object against a form's schema. Returns error strings. */
export function validateRecordData(form: FormDef, data: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const field of form.fields) {
    const raw = (data[field.key] ?? "").toString().trim();
    if (field.required && !raw) {
      errors.push(`${field.label} is required`);
      continue;
    }
    if (!raw) continue;
    if (field.type === "select" && field.options && !field.options.includes(raw)) {
      errors.push(`${field.label} must be one of the allowed options`);
    }
    if (field.type === "number" && isNaN(Number(raw))) {
      errors.push(`${field.label} must be a number`);
    }
  }
  return errors;
}

/**
 * Validate a PARTIAL update — only the keys present in `data` are checked.
 * Used for PATCH, where unprovided fields keep their existing values.
 */
export function validatePartialData(form: FormDef, data: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const field of form.fields) {
    if (!(field.key in data)) continue;
    const raw = (data[field.key] ?? "").toString().trim();
    if (field.required && !raw) {
      errors.push(`${field.label} is required`);
      continue;
    }
    if (!raw) continue;
    if (field.type === "select" && field.options && !field.options.includes(raw)) {
      errors.push(`${field.label} must be one of the allowed options`);
    }
    if (field.type === "number" && isNaN(Number(raw))) {
      errors.push(`${field.label} must be a number`);
    }
  }
  return errors;
}

/** Keep only keys that belong to the form schema, trimmed to strings. */
export function sanitizeRecordData(form: FormDef, data: Record<string, unknown>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const field of form.fields) {
    const v = data[field.key];
    if (v === undefined || v === null) continue;
    clean[field.key] = String(v).trim();
  }
  return clean;
}
