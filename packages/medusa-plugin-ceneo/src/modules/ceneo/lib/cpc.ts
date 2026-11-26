/**
 * CPC BIDS, PROMOTION TEXTS AND THE COMPETITION. Pure, zero runtime imports.
 *
 * MONEY IN GROSZE. A bid is an integer number of grosze (0.25 PLN is 25):
 * no float drift between what the admin shows, the plan and what Ceneo gets.
 *
 * THE PLAN. A person sets a TARGET bid per product (or per Ceneo category);
 * the bids writer moves the current bid towards it, one step per run:
 *
 *   never above `cpc.maxBid`                         (clamped_max)
 *   never more than `cpc.maxBidChangePercent` from   (clamped_step)
 *   the current bid in one run
 *   below Ceneo's suggested minimum: sent, flagged   (below_min)
 *
 * A target of 0 ends bidding on that product. A step from no bid at all is
 * limited by maxBid only (a percentage of nothing is nothing).
 *
 * THE CENEO SHAPES (Swagger examples): the "function" methods answer
 * `{ Response: { Status, Result: { ... } } }`, sometimes without the outer
 * `Response`; a list of one may come as an object. Every reader here takes
 * all of these.
 */

export type BidKind = "product" | "category"

export interface BidRead {
  /** The shop product id (the feed offer id) or the Ceneo category id, as text. */
  key: string
  ceneoProductId: string | null
  name: string | null
  bid: number | null
  clickRate: number | null
  clickRateWithMaxBid: number | null
}

export interface CompetitorOffer {
  shop: string
  price: number | null
  position: number | null
  stock: number | null
  reviews: number | null
  suggested: boolean
  deliveryCost: number | null
}

export interface ProductOffers {
  key: string
  ceneoProductId: string | null
  offersNumber: number | null
  minSuggestedBid: number | null
  offers: CompetitorOffer[]
}

export interface CategoryTopProduct {
  ceneoProductId: number | null
  name: string
  category: string | null
  lowestPrice: number | null
  bidded: boolean
  biddedByMe: boolean
  soldByMe: boolean
  myProductId: string | null
  myPrice: number | null
}

/* ---- money ----------------------------------------------------------------- */

/** PLN (number or "0.2500") to grosze, null when unreadable or negative. */
export function toGrosze(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim().replace(",", ".")) : Number.NaN
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export const toPln = (gr: number): number => Math.round(gr) / 100

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim().replace(",", ".")) : Number.NaN
  return Number.isFinite(n) ? n : null
}
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null)

/* ---- the plan ----------------------------------------------------------------- */

export type PlanReason = "clamped_max" | "clamped_step" | "below_min"

export interface BidPlan {
  /** What the next run sends, in grosze; null: nothing to send. */
  next: number | null
  reasons: PlanReason[]
  /** The target is reached (or there is none). */
  done: boolean
}

export function planBid(args: { current: number | null; target: number | null; maxBid: number | null; maxChangePercent: number; minSuggested: number | null }): BidPlan {
  const { current, target } = args
  if (target === null) return { next: null, reasons: [], done: true }
  const reasons: PlanReason[] = []
  let goal = Math.max(0, Math.round(target))
  if (args.maxBid !== null && goal > args.maxBid) {
    goal = args.maxBid
    reasons.push("clamped_max")
  }
  let next = goal
  const pct = Math.max(1, Math.min(1000, args.maxChangePercent))
  if (current !== null && current > 0 && goal > 0) {
    /* At least 1 gr a step: a small bid never stalls short of its target. */
    const up = Math.max(current + 1, Math.floor(current * (1 + pct / 100)))
    const down = Math.min(current - 1, Math.ceil(current * (1 - pct / 100)))
    if (next > up) next = up
    if (next < down) next = Math.max(1, down)
    if (next !== goal) reasons.push("clamped_step")
  }
  /* The ceiling wins over the step: a bid above maxBid (set in Panel Ceneo, or before maxBid was lowered) comes down to it at once. */
  if (args.maxBid !== null && next > args.maxBid) {
    next = args.maxBid
    if (!reasons.includes("clamped_max")) reasons.push("clamped_max")
  }
  if (next > 0 && args.minSuggested !== null && next < args.minSuggested) reasons.push("below_min")
  if (current !== null && next === current) return { next: null, reasons, done: next === goal }
  return { next, reasons, done: false }
}

/* ---- reading Ceneo's answers ---------------------------------------------- */

function dig(v: unknown, keys: string[]): unknown {
  return keys.reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), v)
}

function list(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
  if (v && typeof v === "object") return [v as Record<string, unknown>]
  return []
}

/** The `Result` of a "function" method, with or without the outer `Response`. */
export function resultOf(body: unknown): unknown {
  return dig(body, ["Response", "Result"]) ?? dig(body, ["Result"]) ?? body
}

/** A "function" answer that says it failed: `Status` other than OK. */
export function functionError(body: unknown): string | null {
  const status = dig(body, ["Response", "Status"]) ?? dig(body, ["Status"])
  if (status === undefined || status === null) return null
  if (String(status).toUpperCase() === "OK") return null
  const msg = dig(body, ["Response", "Result", "Message"]) ?? dig(body, ["Response", "Message"]) ?? dig(body, ["Message"])
  return `Ceneo answered ${String(status)}${typeof msg === "string" ? `: ${msg}` : ""}`
}

/** `bidding.GetProductsBidsByShopProductId`: `Result.bids.bid[]`. */
export function readProductBids(body: unknown): BidRead[] {
  return list(dig(resultOf(body), ["bids", "bid"])).flatMap((b) => {
    const key = text(b.ShopProductId)
    if (!key) return []
    return [{ key, ceneoProductId: text(b.ProductId), name: text(b.ProductName), bid: toGrosze(b.MaxBid), clickRate: toGrosze(b.ClickRate), clickRateWithMaxBid: toGrosze(b.ClickRateWithMaxBid) }]
  })
}

/** `bidding.GetCategoryBidByCategoryId`: `Result.bids.bid[]` with `CategoryId`. */
export function readCategoryBids(body: unknown): BidRead[] {
  return list(dig(resultOf(body), ["bids", "bid"])).flatMap((b) => {
    const key = text(b.CategoryId)
    if (!key) return []
    return [{ key, ceneoProductId: null, name: text(b.CategoryName), bid: toGrosze(b.MaxBid), clickRate: null, clickRateWithMaxBid: null }]
  })
}

/** `shop_getProductTop10OffersBy_IDs`: `Result.product_offers_by_ids.product_offers_by_id[]`. */
export function readTopOffers(body: unknown): ProductOffers[] {
  return list(dig(resultOf(body), ["product_offers_by_ids", "product_offers_by_id"])).flatMap((p) => {
    const key = text(p.ShopProdID)
    if (!key) return []
    const offers = list(p.offers ?? dig(p, ["offers", "offer"])).map((o) => ({
      shop: text(o.CustName) ?? "",
      price: num(o.Price),
      position: num(o.Position),
      stock: num(o.OnStock),
      reviews: num(o.ReviewsNumber),
      suggested: o.SuggestedOffer === true || o.SuggestedOffer === "true",
      deliveryCost: num(o.MinimalDeliveryCost),
    }))
    offers.sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
    return [{ key, ceneoProductId: text(p.CeneoProdID), offersNumber: num(p.OffersNumber), minSuggestedBid: toGrosze(p.MinSuggestedBid), offers: offers.slice(0, 10) }]
  })
}

/** `/api/v3/GetTopCategoryProducts`: a plain array. */
export function readCategoryTop(body: unknown): CategoryTopProduct[] {
  return list(Array.isArray(body) ? body : resultOf(body)).map((p) => ({
    ceneoProductId: num(p.Id),
    name: text(p.Name) ?? "",
    category: text(p.Category),
    lowestPrice: num(p.LowestPrice),
    bidded: p.IsProductBid === true,
    biddedByMe: p.IsProductBidByMe === true,
    soldByMe: p.IsProductSoldByMe === true,
    myProductId: text(p.MyProductId),
    myPrice: num(p.MyPrice),
  }))
}

/** The answers of the promotion text methods: the ids Ceneo did NOT take. */
export function promoRefused(body: unknown, idKey: "ShopProductId" | "CategoryId", okKey: "IsSet" | "IsDeleted"): string[] {
  return list(Array.isArray(body) ? body : resultOf(body))
    .filter((r) => r[okKey] !== true)
    .map((r) => text(r[idKey]))
    .filter((v): v is string => v !== null)
}

/* ---- promotion texts --------------------------------------------------------- */

export const PROMO_MAX = 30
export const PROMO_BATCH = 20

/** A promotion text as Ceneo takes it: one line, at most 30 characters, or null to remove it. */
export function cleanPromo(v: unknown): { ok: true; value: string | null } | { ok: false; reason: "too_long" } {
  if (v === null || v === undefined) return { ok: true, value: null }
  const s = String(v).replace(/\s+/g, " ").trim()
  if (!s) return { ok: true, value: null }
  if ([...s].length > PROMO_MAX) return { ok: false, reason: "too_long" }
  return { ok: true, value: s }
}

/** Rows grouped by the same text, at most 20 ids per call (the Ceneo limit). Null texts are removals. */
export function promoBatches(rows: ReadonlyArray<{ key: string; promo: string | null }>): Array<{ text: string | null; keys: string[] }> {
  const by = new Map<string, string[]>()
  for (const r of rows) {
    const k = r.promo ?? "\u0000"
    by.set(k, [...(by.get(k) ?? []), r.key])
  }
  const out: Array<{ text: string | null; keys: string[] }> = []
  for (const [k, keys] of by) for (let i = 0; i < keys.length; i += PROMO_BATCH) out.push({ text: k === "\u0000" ? null : k, keys: keys.slice(i, i + PROMO_BATCH) })
  return out
}

/** Where the store stands in the top 10: its own position by shop name, the cheapest price, the count. */
export function standing(offers: readonly CompetitorOffer[], shopName: string | null): { position: number | null; lowest: number | null; count: number } {
  const lowest = offers.reduce<number | null>((m, o) => (o.price !== null && (m === null || o.price < m) ? o.price : m), null)
  const mine = shopName ? offers.find((o) => o.shop.toLowerCase() === shopName.toLowerCase()) : undefined
  return { position: mine?.position ?? null, lowest, count: offers.length }
}
