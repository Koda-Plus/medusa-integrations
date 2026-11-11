/**
 * THE CENEO OFFER OF ONE VARIANT, AND THE FILE. Pure: the catalog reader
 * hands over plain variants, this file decides what Ceneo gets and why a
 * variant stays out. Tested on fixtures, no database.
 *
 * Format (https://www.ceneo.pl/poradniki/Instrukcja-tworzenia-pliku-XML):
 *
 *   <offers xmlns:xsi="..." version="1">
 *     <o id url price avail [stock]>
 *       <cat/> <name/> <imgs><main url/><i url/></imgs> <desc/> <attrs><a name/></attrs>
 *     </o>
 *   </offers>
 *
 * PRICE. The calculated price of the configured region, gross, in PLN. A
 * price without tax is never sent: Ceneo shows what the shopper pays, and
 * the price has to match the store page.
 *
 * AVAILABILITY. In stock: `inStockAvail` and `stock` (only when Medusa
 * tracks the stock). Sold out with backorders: `backorderAvail`. Sold out
 * without them: left out ("skip") or `avail` 99 ("check"). Stock Medusa
 * should track but cannot (no inventory item): `avail` 99 with a warning,
 * never a guess that it is in stock.
 */

import { LIMITS, PROBLEMS, type Avail, type OfferState, type ProblemCode, type ProblemSeverity } from "./constants"
import type { ResolvedFeedOptions } from "./options"
import { cdata, charLength, cutChars, oneLine, xmlAttr } from "./xml"

/** One variant as the catalog reader hands it over. */
export interface CatalogVariant {
  id: string
  sku: string | null
  title: string | null
  ean: string | null
  barcode: string | null
  midCode: string | null
  manageInventory: boolean
  allowBackorder: boolean
  productId: string
  productHandle: string | null
  productTitle: string | null
  productStatus: string | null
  /** The product has more than one variant: the name says which one. */
  multiVariant: boolean
  description: string | null
  /** Thumbnail first, then the gallery, as stored. */
  images: string[]
  /** "Parent/Child" of the first product category, or null. */
  categoryPath: string | null
  /** The calculated price in the region, or null without one. */
  price: { amount: number; taxInclusive: boolean } | null
  /** Available units over the counted locations; undefined when Medusa has no inventory item. */
  available: number | undefined
}

export interface OfferProblem {
  code: ProblemCode
  /** A value that helps fixing it: the cut name, the duplicate id. */
  detail?: string
}

export interface OfferPrice {
  amount: number
  currency_code: "pln"
}

/** The offer of one variant, before the ids are checked against the table. */
export interface OfferDraft {
  variantId: string
  productId: string
  sku: string | null
  name: string
  /** The id Ceneo gets, or null when there is none to give. */
  offerId: string | null
  problems: OfferProblem[]
  url: string | null
  price: OfferPrice | null
  avail: Avail | null
  stock: number | null
  category: string | null
  description: string | null
  images: string[]
  attrs: Array<[string, string]>
}

const DEFAULT_VARIANT_TITLES = new Set(["default variant", "default option value", "default", "domyślny", "domyślny wariant"])
const IMAGE_URL = /^https?:\/\/\S+$/i
const EAN = /^(\d{8}|\d{12}|\d{13}|\d{14})$/

/** A GTIN (EAN-8, UPC-A, EAN-13, GTIN-14) with a correct check digit. */
export function isGtin(value: string): boolean {
  if (!EAN.test(value)) return false
  const digits = Array.from(value, Number)
  const check = digits.pop() ?? -1
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === check
}

export function severity(code: ProblemCode): ProblemSeverity {
  return PROBLEMS[code]
}

/** The state of an offer: its worst problem. */
export function offerState(problems: readonly OfferProblem[]): OfferState {
  const s = new Set(problems.map((p) => severity(p.code)))
  if (s.has("error")) return "error"
  if (s.has("excluded")) return "excluded"
  if (s.has("warning")) return "warning"
  return "ok"
}

/** Only "ok" and "warning" go to the file. */
export function isInFeed(d: OfferDraft): boolean {
  const state = offerState(d.problems)
  return (state === "ok" || state === "warning") && d.offerId !== null && d.url !== null && d.price !== null && d.avail !== null
}

function text(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : ""
  return t ? t : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function offerName(v: CatalogVariant): string {
  const product = oneLine(v.productTitle ?? "")
  const variant = oneLine(v.title ?? "")
  if (!v.multiVariant || !variant || DEFAULT_VARIANT_TITLES.has(variant.toLowerCase())) return product
  if (!product) return variant
  return product.toLowerCase().includes(variant.toLowerCase()) ? product : `${product} ${variant}`
}

/**
 * The storefront address from the template. A placeholder without a value
 * (a product without a handle, a variant without a SKU) gives no address:
 * a broken link on Ceneo costs clicks.
 */
export function offerUrl(template: string, v: CatalogVariant): string | null {
  const values: Record<string, string | null> = {
    "{handle}": text(v.productHandle),
    "{product_id}": v.productId,
    "{variant_id}": v.id,
    "{sku}": text(v.sku),
  }
  let missing = false
  const url = template.replace(/\{(handle|product_id|variant_id|sku)\}/g, (ph) => {
    const value = values[ph]
    if (!value) {
      missing = true
      return ""
    }
    return encodeURIComponent(value)
  })
  return missing ? null : url
}

export function buildOfferDraft(v: CatalogVariant, o: ResolvedFeedOptions): OfferDraft {
  const problems: OfferProblem[] = []
  const add = (code: ProblemCode, detail?: string) => problems.push(detail === undefined ? { code } : { code, detail })

  let name = offerName(v)
  const draft: OfferDraft = {
    variantId: v.id,
    productId: v.productId,
    sku: text(v.sku),
    name,
    offerId: null,
    problems,
    url: null,
    price: null,
    avail: null,
    stock: null,
    category: null,
    description: null,
    images: [],
    attrs: [],
  }

  /* An unpublished product is not in the store, so nothing else about it matters to Ceneo. */
  if (v.productStatus !== "published") {
    add("unpublished")
    return draft
  }

  if (!name) add("name_missing")
  else if (charLength(name) > LIMITS.name) {
    name = cutChars(name, LIMITS.name)
    add("name_cut")
  }
  draft.name = name

  /* The id. */
  const wanted = o.offerId === "sku" ? text(v.sku) : v.id
  if (wanted === null) add("sku_missing")
  else if (charLength(wanted) > LIMITS.offerId) add("offer_id_too_long", wanted)
  else draft.offerId = wanted

  /* The address. */
  if (o.productUrl) {
    const url = offerUrl(o.productUrl, v)
    if (url === null) add("url_missing")
    else if (charLength(url) > LIMITS.url) add("url_too_long")
    else draft.url = url
  } else add("url_missing")

  /* The price. */
  if (!v.price || !Number.isFinite(v.price.amount) || v.price.amount <= 0) add("price_missing")
  else if (!v.price.taxInclusive) add("price_net")
  else draft.price = { amount: round2(v.price.amount), currency_code: "pln" }

  /* Availability. */
  if (!v.manageInventory) draft.avail = o.inStockAvail
  else if (v.available === undefined) {
    draft.avail = 99
    add("stock_unknown")
  } else if (v.available > 0) {
    draft.avail = o.inStockAvail
    draft.stock = Math.floor(v.available)
  } else if (v.allowBackorder) draft.avail = o.backorderAvail
  else if (o.outOfStock === "check") draft.avail = 99
  else add("out_of_stock")

  /* Category: the Medusa path until the Ceneo mapping (stage 3) replaces it. */
  const path = v.categoryPath ? oneLine(v.categoryPath) : ""
  if (!path) add("category_missing")
  else if (charLength(path) > LIMITS.category) {
    draft.category = cutChars(path, LIMITS.category)
    add("category_cut")
  } else draft.category = path

  /* Description, HTML kept: Ceneo shows it as sent. */
  const desc = text(v.description)
  if (desc && charLength(desc) > LIMITS.description) {
    draft.description = cutChars(desc, LIMITS.description)
    add("description_cut")
  } else draft.description = desc

  /* Images: absolute http(s) only, each once, at most 20. */
  const seen = new Set<string>()
  let invalid = 0
  for (const raw of v.images) {
    const url = raw.trim()
    if (!url) continue
    if (!IMAGE_URL.test(url) || charLength(url) > LIMITS.url) {
      invalid++
      continue
    }
    seen.add(url)
  }
  const images = [...seen]
  if (invalid > 0) add("image_url_invalid", String(invalid))
  if (images.length === 0) add("image_missing")
  else if (images.length > LIMITS.images) add("images_cut", String(images.length))
  draft.images = images.slice(0, LIMITS.images)

  /* Attributes. */
  const ean = text(v.ean) ?? text(v.barcode)
  if (ean === null) add("ean_missing")
  else if (!isGtin(ean)) add("ean_invalid", ean)
  else draft.attrs.push(["EAN", ean])
  const code = text(v.midCode) ?? text(v.sku)
  if (code) draft.attrs.push(["Kod producenta", cutChars(code, LIMITS.attributes)])

  return draft
}

/**
 * Two variants that want the same id (a SKU used twice). When a variant
 * already holds the id in the offer table (`holderOf`), it keeps it and the
 * newcomers are refused later as `offer_id_taken`: a SKU typed twice by
 * mistake never takes an established offer off Ceneo. With no holder,
 * neither gets it: Ceneo would merge them, and picking one would be a guess.
 */
export function flagDuplicateIds(drafts: OfferDraft[], holderOf: (offerId: string) => string | undefined = () => undefined): void {
  const count = new Map<string, number>()
  for (const d of drafts) if (d.offerId !== null) count.set(d.offerId, (count.get(d.offerId) ?? 0) + 1)
  for (const d of drafts) {
    if (d.offerId !== null && (count.get(d.offerId) ?? 0) > 1 && holderOf(d.offerId) === undefined) {
      d.problems.push({ code: "offer_id_duplicate", detail: d.offerId })
      d.offerId = null
    }
  }
}

export function renderOffer(d: OfferDraft): string {
  const head = [`id="${xmlAttr(d.offerId ?? "")}"`, `url="${xmlAttr(d.url ?? "")}"`, `price="${(d.price?.amount ?? 0).toFixed(2)}"`, `avail="${d.avail ?? 99}"`]
  if (d.stock !== null) head.push(`stock="${d.stock}"`)
  const lines = [`<o ${head.join(" ")}>`]
  if (d.category) lines.push(`<cat>${cdata(d.category)}</cat>`)
  lines.push(`<name>${cdata(d.name)}</name>`)
  if (d.images.length > 0) {
    const [main, ...rest] = d.images
    lines.push(`<imgs><main url="${xmlAttr(main)}"/>${rest.map((u) => `<i url="${xmlAttr(u)}"/>`).join("")}</imgs>`)
  }
  if (d.description) lines.push(`<desc>${cdata(d.description)}</desc>`)
  if (d.attrs.length > 0) lines.push(`<attrs>${d.attrs.map(([n, v]) => `<a name="${xmlAttr(n)}">${cdata(v)}</a>`).join("")}</attrs>`)
  lines.push("</o>")
  return lines.join("\n")
}

/** The whole file: the offers in the feed, sorted by id so the same catalog gives the same bytes. */
export function renderFeed(drafts: readonly OfferDraft[]): string {
  const offers = drafts.filter(isInFeed).sort((a, b) => ((a.offerId ?? "") < (b.offerId ?? "") ? -1 : (a.offerId ?? "") > (b.offerId ?? "") ? 1 : 0))
  const body = offers.map(renderOffer).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<offers xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1">\n${body}${body ? "\n" : ""}</offers>\n`
}

export interface FeedCounters {
  offers: number
  warnings: number
  errors: number
  excluded: number
}

export function countDrafts(drafts: readonly OfferDraft[]): FeedCounters {
  const c: FeedCounters = { offers: 0, warnings: 0, errors: 0, excluded: 0 }
  for (const d of drafts) {
    const state = offerState(d.problems)
    if (state === "error") c.errors++
    else if (state === "excluded") c.excluded++
    else if (isInFeed(d)) {
      c.offers++
      if (state === "warning") c.warnings++
    }
  }
  return c
}
