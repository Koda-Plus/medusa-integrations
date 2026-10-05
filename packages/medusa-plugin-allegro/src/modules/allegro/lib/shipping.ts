/**
 * PARCELS AND SELLER STATUS FOR IMPORTED ORDERS. Pure, zero imports.
 *
 * A Medusa fulfillment of an imported Allegro order becomes:
 *
 *   one parcel per tracking number, `POST /order/checkout-forms/{id}/shipments`
 *   with the carrier, the number and the Allegro line items it carries;
 *   a seller status: READY_FOR_SHIPMENT when the fulfillment is created,
 *   SENT when everything Allegro sold is shipped.
 *
 * Every parcel and every status is one outbox row with a unique key, sent
 * once, looked up on Allegro before it is sent (the seller may have added the
 * same number in the seller panel, and the carrier may have too).
 *
 * The status NEVER GOES BACK: an order Allegro shows as SENT is not set to
 * READY_FOR_SHIPMENT, and CANCELLED, SUSPENDED, RETURNED and PICKED_UP are
 * never touched.
 */

export interface Carrier {
  id: string
  name: string
}

export interface ParcelPlan {
  waybill: string
  carrierId: string
  carrierName: string | null
  /** Allegro line item ids in this parcel; empty means the whole order. */
  lineItemIds: string[]
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** `GET /order/carriers` */
export function carriersFromApi(raw: unknown): Carrier[] {
  const out: Carrier[] = []
  for (const c of Array.isArray(obj(raw).carriers) ? (obj(raw).carriers as unknown[]) : []) {
    const o = obj(c)
    const id = typeof o.id === "string" ? o.id.trim() : ""
    if (!id) continue
    out.push({ id, name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : id })
  }
  return out
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
}

/**
 * The Allegro carrier for a Medusa fulfillment provider: an explicit
 * mapping from the options first (exact id, then prefix), then a carrier
 * whose id or name shares a word with the provider id ("inpost_inpost"
 * finds INPOST), else OTHER with the provider as the carrier name.
 */
export function resolveCarrier(providerId: string | null, carriers: readonly Carrier[], overrides: Readonly<Record<string, string>>): { carrierId: string; carrierName: string | null } {
  const provider = String(providerId ?? "").trim()
  const direct = overrides[provider] ?? Object.entries(overrides).find(([k]) => k && provider.startsWith(k))?.[1]
  if (direct) {
    const known = carriers.find((c) => c.id.toUpperCase() === direct.toUpperCase())
    if (direct.toUpperCase() === "OTHER") return { carrierId: "OTHER", carrierName: humanName(provider) }
    return { carrierId: known?.id ?? direct.toUpperCase(), carrierName: null }
  }
  const words = tokens(provider)
  for (const c of carriers) {
    if (c.id === "OTHER") continue
    const carrierWords = new Set([...tokens(c.id), ...tokens(c.name)])
    if (words.some((w) => carrierWords.has(w))) return { carrierId: c.id, carrierName: null }
  }
  return { carrierId: "OTHER", carrierName: humanName(provider) }
}

function humanName(provider: string): string {
  const base = provider.split("_")[0] || provider || "Courier"
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 30)
}

/** A tracking number Allegro accepts: not empty, at most 64 characters. */
export function cleanWaybill(value: unknown): string | null {
  if (typeof value !== "string") return null
  const s = value.trim()
  return s && s.length <= 64 ? s : null
}

export interface FulfillmentLike {
  providerId: string | null
  canceled: boolean
  labels: Array<{ trackingNumber: string | null }>
  /** Medusa line item id and quantity of each fulfilled item. */
  items: Array<{ lineItemId: string | null; quantity: number }>
}

/**
 * Parcels of one fulfillment. `allegroLines` maps a Medusa line item id to
 * its Allegro line item id (the import puts it in the line item metadata).
 */
export function parcelsOf(f: FulfillmentLike, allegroLines: ReadonlyMap<string, string>, carriers: readonly Carrier[], overrides: Readonly<Record<string, string>>): ParcelPlan[] {
  if (f.canceled) return []
  const carrier = resolveCarrier(f.providerId, carriers, overrides)
  const lineItemIds = [...new Set(f.items.map((i) => (i.lineItemId ? allegroLines.get(i.lineItemId) : undefined)).filter((x): x is string => Boolean(x)))]
  const out: ParcelPlan[] = []
  const seen = new Set<string>()
  for (const label of f.labels) {
    const waybill = cleanWaybill(label.trackingNumber)
    if (!waybill || seen.has(waybill.toUpperCase())) continue
    seen.add(waybill.toUpperCase())
    out.push({ waybill, carrierId: carrier.carrierId, carrierName: carrier.carrierId === "OTHER" ? carrier.carrierName : null, lineItemIds })
  }
  return out
}

/** `GET /order/checkout-forms/{id}/shipments`: the waybills already on the order. */
export function waybillsFromApi(raw: unknown): Array<{ id: string | null; waybill: string; carrierId: string | null }> {
  const out: Array<{ id: string | null; waybill: string; carrierId: string | null }> = []
  for (const s of Array.isArray(obj(raw).shipments) ? (obj(raw).shipments as unknown[]) : []) {
    const o = obj(s)
    const waybill = typeof o.waybill === "string" ? o.waybill.trim() : ""
    if (!waybill) continue
    out.push({ id: typeof o.id === "string" ? o.id : null, waybill, carrierId: typeof o.carrierId === "string" ? o.carrierId : null })
  }
  return out
}

export function hasWaybill(existing: ReadonlyArray<{ waybill: string }>, waybill: string): boolean {
  const w = waybill.trim().toUpperCase()
  return existing.some((e) => e.waybill.trim().toUpperCase() === w)
}

const RANK: Record<string, number> = {
  NEW: 0,
  PROCESSING: 1,
  READY_FOR_SHIPMENT: 2,
  READY_FOR_PICKUP: 2,
  SENT: 3,
}

/**
 * Whether the seller status should move to `wanted`. Never back, never out
 * of a final or a manual state.
 */
export function shouldSetStatus(current: string | null, wanted: "READY_FOR_SHIPMENT" | "SENT"): boolean {
  const c = String(current ?? "NEW").toUpperCase()
  if (!(c in RANK)) return false
  return RANK[c] < RANK[wanted]
}

/** Every Allegro line shipped in full? Quantities of the Medusa fulfillments, keyed by Allegro line id. */
export function allShipped(ordered: ReadonlyMap<string, number>, shipped: ReadonlyMap<string, number>): boolean {
  if (ordered.size === 0) return false
  for (const [line, quantity] of ordered) if ((shipped.get(line) ?? 0) < quantity) return false
  return true
}

export function parcelKey(checkoutFormId: string, waybill: string): string {
  return `parcel:${checkoutFormId}:${waybill.trim().toUpperCase()}`
}

export function statusKey(checkoutFormId: string, status: string): string {
  return `status:${checkoutFormId}:${status}`
}
