/**
 * WRITES INTO MEDUSA, ONLY WHEN TWO SWITCHES SAY SO. Zero imports.
 *
 * Accepting a negotiation always records the agreed price and emits
 * `negotiation.accepted`; nothing else in the store changes. One writer can
 * do more:
 *
 *   draftOrders  an accepted thread becomes a Medusa draft order for its
 *                customer, one line of the variant at the agreed unit price,
 *                for the team to finish (shipping, address) and convert
 *
 * Switch one, the hard switch: the option `writers.draftOrders`. Default
 * false in live mode and true in demo mode (where the writer only
 * simulates). `false` turns it off for good: the admin cannot arm it.
 *
 * Switch two, the runtime toggle: a person arms the writer in Settings. It is
 * stored in `negotiation_setting` with who flipped it and when, apart for
 * demo and live mode, and it starts off. The writer writes only when both
 * say yes ("armed"), and only threads accepted while it is armed (or queued
 * by a person on purpose) get a draft: arming it never sweeps the history.
 */

export const WRITERS = ["draftOrders"] as const
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
  /** The options allow it. */
  allowed: boolean
  /** A person turned it on in the admin. */
  on: boolean
  /** It writes: allowed and on. */
  armed: boolean
  updatedBy: string | null
  updatedAt: string | null
}

/** Where a writer's toggle is stored. Demo and live never share a toggle. */
export function writerSettingKey(writer: WriterKey, demo: boolean): string {
  return `${demo ? "demo" : "live"}:writer:${writer}`
}

export function writerState(key: WriterKey, allowed: Readonly<Record<WriterKey, boolean>>, setting: WriterSetting | null): WriterState {
  const isAllowed = allowed[key] === true
  const on = Boolean(setting?.on)
  return { key, allowed: isAllowed, on, armed: isAllowed && on, updatedBy: setting?.updatedBy ?? null, updatedAt: setting?.updatedAt ?? null }
}

/** A stored setting value as a writer toggle. */
export function readWriterSetting(row: { value?: unknown; updated_by?: string | null; updated_at?: Date | string | null } | null | undefined): WriterSetting | null {
  if (!row) return null
  const value = row.value && typeof row.value === "object" ? (row.value as Record<string, unknown>) : {}
  const at = row.updated_at ? new Date(row.updated_at as string) : null
  return { on: value.on === true, updatedBy: row.updated_by ?? null, updatedAt: at && Number.isFinite(at.getTime()) ? at.toISOString() : null }
}
