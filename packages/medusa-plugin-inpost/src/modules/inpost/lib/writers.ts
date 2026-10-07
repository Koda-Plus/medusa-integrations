/**
 * WRITES THE PLUGIN DOES ONLY WHEN TWO SWITCHES SAY SO. Zero imports.
 *
 *   shipment           ShipX writes: create a shipment from the plan a person
 *                      read, pay the offer of a prepaid account, order a
 *                      courier pickup, cancel a shipment ShipX still allows
 *   fulfillmentStatus  Medusa writes: mark the fulfillment shipped when
 *                      InPost has the parcel and delivered when it is
 *                      delivered (Medusa's own shipment and delivery flows)
 *
 * Switch one, the hard switch: the option (`shipmentWriter`,
 * `fulfillmentStatusWriter`), false by default in live mode. `false` wins:
 * the admin cannot arm a writer the options turn off.
 *
 * Switch two, the runtime toggle: a person arms the writer in Settings. It is
 * stored in `inpost_setting` with who flipped it and when, apart for demo and
 * live mode, and it starts off. A writer writes only when both say yes.
 *
 * Without the shipment writer the plugin still works: fulfillments record the
 * locker and the service, plans are shown, labels and statuses of existing
 * shipments are read.
 */

export const WRITERS = ["shipment", "fulfillmentStatus"] as const
export type WriterKey = (typeof WRITERS)[number]

export function isWriterKey(v: unknown): v is WriterKey {
  return typeof v === "string" && (WRITERS as readonly string[]).includes(v)
}

/** The option name of each writer, for messages and the admin. */
export const WRITER_OPTION: Record<WriterKey, string> = {
  shipment: "shipmentWriter",
  fulfillmentStatus: "fulfillmentStatusWriter",
}

export interface WriterSetting {
  on: boolean
  updatedBy: string | null
  updatedAt: string | null
}

export interface WriterState {
  key: WriterKey
  /** The option allows it. */
  allowed: boolean
  /** A person armed it in the admin. */
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

export function writerState(key: WriterKey, allowed: Record<WriterKey, boolean>, setting: WriterSetting | null): WriterState {
  const on = Boolean(setting?.on)
  return { key, allowed: allowed[key], on, armed: allowed[key] && on, updatedBy: setting?.updatedBy ?? null, updatedAt: setting?.updatedAt ?? null }
}

/** A stored setting row as a writer toggle. */
export function readWriterSetting(row: { value?: unknown; updated_by?: string | null; updated_at?: Date | string | null } | null | undefined): WriterSetting | null {
  if (!row) return null
  const value = row.value && typeof row.value === "object" ? (row.value as Record<string, unknown>) : {}
  const at = row.updated_at ? new Date(row.updated_at as string) : null
  return { on: value.on === true, updatedBy: row.updated_by ?? null, updatedAt: at && Number.isFinite(at.getTime()) ? at.toISOString() : null }
}
