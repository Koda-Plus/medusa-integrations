/**
 * ORDERS SHIPPED OUTSIDE MEDUSA. Zero imports.
 *
 * Generalized from the backend of a Polish cosmetics wholesaler, where a
 * warehouse app ships the parcels itself and leaves its trace in the order
 * metadata. A fulfillment
 * created afterwards in Medusa (to release the reservations and set the
 * status) must not create a second parcel: a second label is a real parcel
 * and a real cost.
 *
 * `skipMetadataKeys` names the metadata keys that mean "already shipped":
 * empty by default; a setup like that one uses `inpost_shipment` (the trace
 * of the warehouse app, `{ shipment_id, tracking_number }`) and a key of its
 * ERP document. The check runs when the fulfillment is recorded AND again
 * right before a shipment is created, so a key written in between still
 * stops it. A key holding a ShipX shipment id lets the plugin track that
 * shipment (read only) instead of creating one.
 */

/** A metadata value that says something: not undefined, null, false, "" or an empty object or list. */
function present(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return false
  if (typeof v === "string") return v.trim() !== ""
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === "object") return Object.keys(v as object).length > 0
  return true
}

/** The first configured key the order metadata carries, or null. */
export function shippedOutsideKey(metadata: Record<string, unknown> | null | undefined, keys: readonly string[]): string | null {
  if (!metadata || typeof metadata !== "object" || keys.length === 0) return null
  for (const key of keys) if (present(metadata[key])) return key
  return null
}

/**
 * A ShipX shipment id in the value of a guard key: `{ shipment_id: 123 }` or
 * `{ shipment_ids: [123, 124] }` (the first). Null for anything else, a bare
 * number included: it may be an ERP document number, never read as a
 * shipment. The key then only stops the creation.
 */
export function externalShipmentId(value: unknown): string | null {
  const asId = (v: unknown): string | null => {
    const s = typeof v === "number" || typeof v === "string" ? String(v).trim() : ""
    return /^\d{1,15}$/.test(s) ? s : null
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (v.shipment_id !== undefined && v.shipment_id !== null) return asId(v.shipment_id)
  if (Array.isArray(v.shipment_ids)) return asId(v.shipment_ids[0])
  return null
}
