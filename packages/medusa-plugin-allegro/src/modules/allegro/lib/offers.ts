/**
 * ALLEGRO OFFERS AS THE PLUGIN SEES THEM. Zero imports (unit tests run it as is).
 *
 * We keep only what the matching, the stock check and the admin need: id,
 * name, status, the seller's signature (`external.id`), price, quantities,
 * format and two dates. Images, descriptions, parameters and delivery
 * settings of the offer are NOT stored.
 */

export interface AllegroPrice {
  value: number
  currency: string
}

export interface AllegroOfferInput {
  /** Offer id in Allegro. A number, kept as a string. */
  allegroId: string
  name: string
  /** INACTIVE (draft), ACTIVATING, ACTIVE or ENDED. */
  status: string
  /**
   * `external.id`, the seller's signature ("sygnatura"). Feeds, BaseLinker
   * and most listing tools put the SKU here; it is the matching key.
   */
  externalId: string | null
  price: AllegroPrice | null
  /** Items Allegro can still sell. Null when the offer carries no stock. */
  available: number | null
  /** Items sold in the last 30 days. */
  sold: number | null
  /** BUY_NOW, AUCTION or ADVERTISEMENT. */
  format: string | null
  categoryId: string | null
  startedAt: string | null
  endingAt: string | null
  /** Who or what ended the offer (USER, EXPIRATION, EMPTY_STOCK, ADMIN...). */
  endedBy: string | null
}

export const OFFER_STATUSES = ["ACTIVE", "ACTIVATING", "INACTIVE", "ENDED"] as const

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

function int(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

function iso(v: unknown): string | null {
  const s = text(v)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** Price from `{ amount: "123.45", currency: "PLN" }`. Allegro sends amounts as strings. */
export function priceFrom(v: unknown): AllegroPrice | null {
  const p = obj(v)
  const value = Number(p.amount)
  const currency = text(p.currency)
  if (!Number.isFinite(value) || !currency) return null
  return { value, currency: currency.toUpperCase() }
}

/**
 * One item of `GET /sale/offers` (`offers[]`) into our shape. Returns null for
 * an item without an id: there is nothing to key it by.
 */
export function offerFromApi(raw: unknown): AllegroOfferInput | null {
  const o = obj(raw)
  const id = text(o.id)
  if (!id) return null
  const publication = obj(o.publication)
  const stock = obj(o.stock)
  const selling = obj(o.sellingMode)
  const sale = obj(o.saleInfo)
  const status = (text(publication.status) ?? "INACTIVE").toUpperCase()
  return {
    allegroId: id,
    name: text(o.name) ?? id,
    status,
    externalId: text(obj(o.external).id),
    /* BUY_NOW keeps its price in sellingMode; an auction in progress shows the current bid. */
    price: priceFrom(selling.price) ?? priceFrom(sale.currentPrice) ?? priceFrom(selling.startingPrice),
    available: int(stock.available),
    sold: int(stock.sold),
    format: text(selling.format),
    categoryId: text(obj(o.category).id),
    startedAt: iso(publication.startedAt),
    endingAt: iso(publication.endingAt),
    endedBy: text(publication.endedBy),
  }
}

/** A page of offers, with the count per status (including statuses we do not know yet). */
export function offersFromApi(raw: readonly unknown[]): { offers: AllegroOfferInput[]; statuses: Record<string, number> } {
  const offers: AllegroOfferInput[] = []
  const statuses: Record<string, number> = {}
  for (const item of raw) {
    const offer = offerFromApi(item)
    if (!offer) continue
    offers.push(offer)
    statuses[offer.status] = (statuses[offer.status] ?? 0) + 1
  }
  return { offers, statuses }
}
