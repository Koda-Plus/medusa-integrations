/**
 * WRITES THE PLUGIN DOES ONLY WHEN TWO SWITCHES SAY SO. Zero imports.
 *
 *   shipment           DPD writes that create a parcel: waybill numbers, the
 *                      label (it advises the parcels), the return label
 *   pickup             the courier order: a courier really comes, and it
 *                      costs money, so it has its own switch
 *   fulfillmentStatus  Medusa writes: mark the fulfillment shipped when DPD
 *                      has the parcel and delivered when every waybill is
 *                      delivered (Medusa's own shipment and delivery flows)
 *
 * Switch one, the hard switch: the option (`shipmentWriter`, `pickupWriter`,
 * `fulfillmentStatusWriter`), false by default outside demo mode. `false`
 * wins: the admin cannot arm a writer the options turn off.
 *
 * Switch two, the runtime toggle: a person arms the writer in Settings. It is
 * stored in `dpd_setting` with who flipped it and when, apart for each mode
 * (demo, sandbox, live), and it starts off. A writer writes only when both
 * say yes.
 */

export const WRITERS = ["shipment", "pickup", "fulfillmentStatus"] as const
export type WriterKey = (typeof WRITERS)[number]

export function isWriterKey(v: unknown): v is WriterKey {
  return typeof v === "string" && (WRITERS as readonly string[]).includes(v)
}

/** The option name of each writer, for messages and the admin. */
export const WRITER_OPTION: Record<WriterKey, string> = {
  shipment: "shipmentWriter",
  pickup: "pickupWriter",
  fulfillmentStatus: "fulfillmentStatusWriter",
}

export type WriterSetting = {
  on: boolean
  updatedBy: string | null
  updatedAt: string | null
}

export type WriterState = {
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

/** Where a writer's toggle is stored. Modes never share a toggle: arming the sandbox never arms live. */
export function writerSettingKey(writer: WriterKey, mode: "demo" | "sandbox" | "live"): string {
  return `${mode}:writer:${writer}`
}

export function writerState(key: WriterKey, allowed: Record<WriterKey, boolean>, setting: WriterSetting | null): WriterState {
  const on = Boolean(setting?.on)
  return { key, allowed: allowed[key], on, armed: allowed[key] && on, updatedBy: setting?.updatedBy ?? null, updatedAt: setting?.updatedAt ?? null }
}

/** A stored setting row as a writer toggle. */
export function readWriterSetting(row: { value?: unknown; updated_by?: string | null; updated_at?: Date | string | null } | null | undefined): WriterSetting | null {
  if (!row) return null
  const value = row.value && typeof row.value === "object" ? (row.value as Record<string, unknown>) : {}
  const at = row.updated_at ? new Date(row.updated_at) : null
  return { on: value.on === true, updatedBy: row.updated_by ?? null, updatedAt: at && Number.isFinite(at.getTime()) ? at.toISOString() : null }
}
