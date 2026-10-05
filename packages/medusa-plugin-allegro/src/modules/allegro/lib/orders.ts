/**
 * ALLEGRO ORDERS (CHECKOUT FORMS) AS THE PLUGIN SEES THEM. Zero imports.
 *
 * A READ-ONLY JOURNAL WITHOUT PERSONAL DATA. We keep what tells the team
 * what was sold and whether it is on its way: ids, statuses, lines (offer,
 * signature, quantity, price), the delivery method name and the total. The
 * buyer, the address, the phone number, the e-mail and the payment details
 * are NOT stored. Orders stay in Allegro; the journal only shows them next to
 * the store, with every line linked to its product.
 */

export interface AllegroMoney {
  value: number
  currency: string
}

export interface AllegroOrderLine {
  offerId: string
  offerName: string
  /** Signature of the offer at the time of purchase. */
  externalId: string | null
  quantity: number
  /** Price of one item. */
  price: AllegroMoney | null
}

export interface AllegroOrderInput {
  /** Checkout form id, a UUID. */
  allegroId: string
  /** BOUGHT, FILLED_IN, READY_FOR_PROCESSING or CANCELLED. */
  status: string
  /** NEW, PROCESSING, READY_FOR_SHIPMENT, READY_FOR_PICKUP, SENT, PICKED_UP, CANCELLED, SUSPENDED, RETURNED. */
  fulfillmentStatus: string | null
  total: AllegroMoney | null
  /** Earliest `boughtAt` of the lines. */
  boughtAt: string | null
  updatedAt: string | null
  deliveryMethod: string | null
  marketplace: string | null
  lines: AllegroOrderLine[]
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

function money(v: unknown): AllegroMoney | null {
  const m = obj(v)
  const value = Number(m.amount)
  const currency = text(m.currency)
  if (!Number.isFinite(value) || !currency) return null
  return { value, currency: currency.toUpperCase() }
}

function iso(v: unknown): string | null {
  const s = text(v)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** One item of `GET /order/checkout-forms` (`checkoutForms[]`), or null without an id. */
export function orderFromApi(raw: unknown): AllegroOrderInput | null {
  const o = obj(raw)
  const id = text(o.id)
  if (!id) return null
  const lines: AllegroOrderLine[] = []
  let boughtAt: string | null = null
  for (const item of Array.isArray(o.lineItems) ? o.lineItems : []) {
    const li = obj(item)
    const offer = obj(li.offer)
    const offerId = text(offer.id)
    if (!offerId) continue
    const quantity = Number(li.quantity)
    lines.push({
      offerId,
      offerName: text(offer.name) ?? offerId,
      externalId: text(obj(offer.external).id),
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 1,
      price: money(li.price) ?? money(li.originalPrice),
    })
    const bought = iso(li.boughtAt)
    if (bought && (!boughtAt || bought < boughtAt)) boughtAt = bought
  }
  return {
    allegroId: id,
    status: (text(o.status) ?? "BOUGHT").toUpperCase(),
    fulfillmentStatus: text(obj(o.fulfillment).status)?.toUpperCase() ?? null,
    total: money(obj(o.summary).totalToPay),
    boughtAt,
    updatedAt: iso(o.updatedAt),
    deliveryMethod: text(obj(obj(o.delivery).method).name),
    marketplace: text(obj(o.marketplace).id),
    lines,
  }
}

export function ordersFromApi(raw: readonly unknown[]): AllegroOrderInput[] {
  const out: AllegroOrderInput[] = []
  for (const item of raw) {
    const order = orderFromApi(item)
    if (order) out.push(order)
  }
  return out
}

/** Order states for the admin filters. */
export type OrderGroup = "open" | "sent" | "cancelled"

export function orderGroup(status: string | null | undefined, fulfillment: string | null | undefined): OrderGroup {
  const s = String(status ?? "").toUpperCase()
  const f = String(fulfillment ?? "").toUpperCase()
  if (s === "CANCELLED" || f === "CANCELLED" || f === "RETURNED") return "cancelled"
  if (f === "SENT" || f === "PICKED_UP" || f === "READY_FOR_PICKUP") return "sent"
  return "open"
}

export interface LinkedLine extends AllegroOrderLine {
  variantId: string | null
  productId: string | null
  sku: string | null
  productTitle: string | null
}

export interface LineVariant {
  id: string
  productId: string
  sku: string
  productTitle: string | null
}

/**
 * Links order lines to variants: first by the offer link from the offer
 * snapshot (the offer id is stable), then by the signature printed on the
 * line, uppercased. A line that matches neither is "without product".
 */
export function linkLines(
  lines: readonly AllegroOrderLine[],
  byOfferId: ReadonlyMap<string, LineVariant>,
  bySku: ReadonlyMap<string, LineVariant>,
): { lines: LinkedLine[]; unmatched: number } {
  let unmatched = 0
  const out = lines.map((l) => {
    const v = byOfferId.get(l.offerId) ?? (l.externalId ? bySku.get(l.externalId.trim().toUpperCase()) : undefined) ?? null
    if (!v) unmatched += 1
    return {
      ...l,
      variantId: v?.id ?? null,
      productId: v?.productId ?? null,
      sku: v?.sku ?? null,
      productTitle: v?.productTitle ?? null,
    }
  })
  return { lines: out, unmatched }
}
