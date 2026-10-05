/**
 * PUBLISH BY EAN: draft offers for variants that have an EAN and no offer.
 * Pure, zero imports.
 *
 *   1. a variant with a GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) and no linked
 *      offer is looked up in the Allegro catalog: `GET /sale/products?phrase=
 *      {ean}&mode=GTIN`;
 *   2. exactly one catalog product: a plan item "create a draft"; none or
 *      several: skipped with the reason (never a guess between products);
 *   3. an armed publish writer sends `POST /sale/product-offers` with
 *      `publication.status: INACTIVE`. The offer is a DRAFT the seller
 *      reviews and activates on Allegro; the plugin never activates it (the
 *      write barrier refuses any other status).
 */

import type { PlanStatus } from "./stock-plan"

export type PublishReason = "create" | "no_ean" | "has_offer" | "not_in_catalog" | "ambiguous" | "no_price" | "no_stock" | "options_missing" | "search_failed"

export interface PublishVariant {
  id: string
  sku: string
  productId: string
  title: string
  ean: string | null
  price: { value: number; currency: string } | null
  available: number | null
}

export interface CatalogMatch {
  status: "one" | "none" | "many" | "failed"
  productId: string | null
  productName: string | null
  categoryId: string | null
}

export interface PublishEntry {
  variantId: string
  sku: string
  productId: string
  title: string
  ean: string | null
  catalogProductId: string | null
  catalogName: string | null
  price: { amount: string; currency: string } | null
  quantity: number | null
  reason: PublishReason
  status: PlanStatus
}

/** GTIN-8, -12, -13 or -14 with a valid check digit. */
export function validGtin(value: string | null | undefined): string | null {
  const s = String(value ?? "").replace(/\s/g, "")
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(s)) return null
  const digits = s.split("").map(Number)
  const check = digits.pop() as number
  const sum = digits
    .reverse()
    .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check ? s : null
}

/** `GET /sale/products` answer for one EAN. */
export function catalogMatchFromApi(raw: unknown): CatalogMatch {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const products = Array.isArray(o.products) ? o.products : []
  const ids = new Map<string, { name: string | null; categoryId: string | null }>()
  for (const p of products) {
    const pp = p && typeof p === "object" ? (p as Record<string, unknown>) : {}
    const id = typeof pp.id === "string" ? pp.id : null
    if (!id) continue
    const category = pp.category && typeof pp.category === "object" ? (pp.category as Record<string, unknown>) : {}
    const prev = ids.get(id)
    /* The same product twice in one answer: keep what the fuller entry says. */
    ids.set(id, {
      name: prev?.name ?? (typeof pp.name === "string" ? pp.name : null),
      categoryId: prev?.categoryId ?? (typeof category.id === "string" ? category.id : null),
    })
  }
  if (ids.size === 0) return { status: "none", productId: null, productName: null, categoryId: null }
  if (ids.size > 1) return { status: "many", productId: null, productName: null, categoryId: null }
  const [[id, info]] = [...ids]
  return { status: "one", productId: id, productName: info.name, categoryId: info.categoryId }
}

function money(p: PublishVariant["price"]): { amount: string; currency: string } | null {
  if (!p || !Number.isFinite(p.value) || p.value <= 0) return null
  return { amount: (Math.round(p.value * 100) / 100).toFixed(2), currency: p.currency.toUpperCase() }
}

export function planPublish(input: {
  variants: readonly PublishVariant[]
  /** Variants that already have an Allegro offer (any status). */
  linked: ReadonlySet<string>
  matches: ReadonlyMap<string, CatalogMatch>
  optionsMissing: readonly string[]
  cap: number
  quarantined: ReadonlySet<string>
}): PublishEntry[] {
  const out: PublishEntry[] = []
  for (const v of input.variants) {
    const ean = validGtin(v.ean)
    const base = {
      variantId: v.id,
      sku: v.sku,
      productId: v.productId,
      title: v.title,
      ean,
      catalogProductId: null as string | null,
      catalogName: null as string | null,
      price: money(v.price),
      quantity: v.available,
    }
    if (input.linked.has(v.id)) continue
    if (!ean) continue
    const match = input.matches.get(ean)
    if (!match) continue
    if (match.status === "failed") {
      out.push({ ...base, reason: "search_failed", status: "skipped" })
      continue
    }
    if (match.status === "none") {
      out.push({ ...base, reason: "not_in_catalog", status: "skipped" })
      continue
    }
    if (match.status === "many") {
      out.push({ ...base, reason: "ambiguous", status: "skipped" })
      continue
    }
    const entry = { ...base, catalogProductId: match.productId, catalogName: match.productName }
    if (!entry.price) out.push({ ...entry, reason: "no_price", status: "skipped" })
    else if (v.available !== null && v.available <= 0) out.push({ ...entry, reason: "no_stock", status: "skipped" })
    else if (input.optionsMissing.length > 0) out.push({ ...entry, reason: "options_missing", status: "skipped" })
    else out.push({ ...entry, reason: "create", status: "planned" })
  }
  let budget = Math.max(0, Math.floor(input.cap))
  for (const e of out) {
    if (e.status !== "planned") continue
    if (input.quarantined.has(e.variantId)) e.status = "quarantined"
    else if (budget > 0) budget -= 1
    else e.status = "deferred"
  }
  return out
}

/** The body of `POST /sale/product-offers` for one draft. */
export function draftOfferBody(
  entry: Pick<PublishEntry, "catalogProductId" | "price" | "quantity" | "sku">,
  opts: { shippingRatesId: string; location: { city: string; postCode: string; province: string | null; countryCode: string }; invoice: string },
): Record<string, unknown> {
  return {
    productSet: [{ product: { id: entry.catalogProductId } }],
    sellingMode: { price: entry.price },
    stock: { available: Math.max(1, Math.floor(entry.quantity ?? 1)) },
    external: { id: entry.sku.slice(0, 100) },
    /* `shippingRates` takes the id (a UUID) or the name of a shipping rates set. */
    delivery: {
      shippingRates: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opts.shippingRatesId)
        ? { id: opts.shippingRatesId }
        : { name: opts.shippingRatesId },
    },
    location: {
      city: opts.location.city,
      countryCode: opts.location.countryCode,
      postCode: opts.location.postCode,
      ...(opts.location.province ? { province: opts.location.province } : {}),
    },
    payments: { invoice: opts.invoice },
    publication: { status: "INACTIVE" },
  }
}
