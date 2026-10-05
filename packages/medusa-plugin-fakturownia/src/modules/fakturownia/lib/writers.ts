/**
 * WRITES THE PLUGIN DOES ONLY WHEN TWO SWITCHES SAY SO. Zero imports.
 *
 * Every write added in 0.2.0 ships OFF:
 *
 *   corrections  issue the correction invoices a person approved
 *   emails       e-mail a document from the admin (send, send again, a
 *                payment reminder)
 *   ksef         ask Fakturownia to send a document to KSeF again
 *
 * Switch one, the hard switch: the option `writers.<name>` (true by default).
 * `false` turns the writer off for good: the admin cannot turn it on, so a
 * store can forbid a write in `medusa-config.ts` or through an environment
 * variable. `corrections: "off"` turns the corrections writer off as well.
 *
 * Switch two, the runtime toggle: a person turns the writer on in the admin.
 * It is stored in `fakturownia_setting` with who flipped it and when, apart
 * for demo and live mode, and it starts off. A writer writes only when both
 * say yes ("armed").
 *
 * The writes of 0.1.0 keep their own options and defaults: issuing documents
 * (always), marking them paid (`markPaidOnCapture`), rejecting a proforma of
 * a canceled order (`cancelOnOrderCanceled`) and the automatic e-mail after
 * issue (`sendByEmail`; `writers.emails: false` stops it too).
 */

export const WRITERS = ["corrections", "emails", "ksef"] as const
export type WriterKey = (typeof WRITERS)[number]

export function isWriterKey(v: unknown): v is WriterKey {
  return typeof v === "string" && (WRITERS as readonly string[]).includes(v)
}

/** The stored toggle of a writer. */
export interface WriterSetting {
  on: boolean
  updatedBy: string | null
  updatedAt: string | null
}

export interface WriterState {
  key: WriterKey
  /** The options allow it: `writers.<key>` is not false (and for corrections, `corrections` is not "off"). */
  allowed: boolean
  /** A person turned it on in the admin. */
  on: boolean
  /** It writes: allowed and on. */
  armed: boolean
  updatedBy: string | null
  updatedAt: string | null
}

export interface WriterOptions {
  writers: Record<WriterKey, boolean>
  corrections: "plan" | "off"
}

/** Where a writer's toggle is stored. Demo and live never share a toggle. */
export function writerSettingKey(writer: WriterKey, demo: boolean): string {
  return `${demo ? "demo" : "live"}:writer:${writer}`
}

export function writerState(key: WriterKey, o: WriterOptions, setting: WriterSetting | null): WriterState {
  const allowed = o.writers[key] !== false && !(key === "corrections" && o.corrections === "off")
  const on = Boolean(setting?.on)
  return { key, allowed, on, armed: allowed && on, updatedBy: setting?.updatedBy ?? null, updatedAt: setting?.updatedAt ?? null }
}

/** A stored setting value as a writer toggle. */
export function readWriterSetting(row: { value?: unknown; updated_by?: string | null; updated_at?: Date | string | null } | null | undefined): WriterSetting | null {
  if (!row) return null
  const value = row.value && typeof row.value === "object" ? (row.value as Record<string, unknown>) : {}
  const at = row.updated_at ? new Date(row.updated_at as string) : null
  return { on: value.on === true, updatedBy: row.updated_by ?? null, updatedAt: at && Number.isFinite(at.getTime()) ? at.toISOString() : null }
}
