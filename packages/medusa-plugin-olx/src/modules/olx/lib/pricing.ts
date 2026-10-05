/**
 * THE PRICE PLAN AND THE ADVERT UPDATE BODY. Pure.
 *
 * WHICH PRICE. The base price of the variant in the market currency: no price
 * list, no rules (region, customer group), no quantity tier. A variant
 * without such a price is skipped, never planned as zero.
 *
 * WHICH ADVERTS. Live adverts linked to a variant that is published and in
 * stock, whose OLX price has the market currency and differs by at least one
 * cent. Adverts on their way out (sold out, unpublished) are left to the
 * lifecycle writer. Changes above `maxPriceChangePercent` are planned as held:
 * a person approves them in the admin.
 *
 * HOW. `PUT /adverts/{id}` REPLACES the advert ("All parameters and
 * validation rules are the same as in Create advert section", with title,
 * description, category, advertiser type, contact, location and attributes
 * required). So the writer reads the advert first and sends every documented
 * field back unchanged, only the price value differs. Fields OLX does not
 * accept are left out: an extra field makes OLX refuse the whole body.
 */

import { hasStock, isPublished, type StockState } from "./stock"

export interface PriceRecord {
  amount?: number | string | null
  currency_code?: string | null
  rules_count?: number | null
  price_list_id?: string | null
  min_quantity?: number | string | null
}

export interface Money {
  value: number
  currency: string
}

/** The base price of a variant in `currency` (any case), or null. */
export function basePrice(prices: readonly PriceRecord[] | null | undefined, currency: string): number | null {
  const wanted = currency.trim().toLowerCase()
  const candidates: number[] = []
  for (const p of prices ?? []) {
    if (!p || String(p.currency_code ?? "").toLowerCase() !== wanted) continue
    if (p.price_list_id) continue
    if (Number(p.rules_count ?? 0) > 0) continue
    const minQ = p.min_quantity === null || p.min_quantity === undefined || p.min_quantity === "" ? null : Number(p.min_quantity)
    if (minQ !== null && Number.isFinite(minQ) && minQ > 1) continue
    const amount = typeof p.amount === "number" ? p.amount : Number(p.amount)
    if (Number.isFinite(amount) && amount > 0) candidates.push(amount)
  }
  if (candidates.length === 0) return null
  return Math.min(...candidates)
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function samePrice(a: number, b: number): boolean {
  return Math.abs(round2(a) - round2(b)) < 0.005
}

export interface PriceAdvert {
  olxId: string
  status: string
  variantId: string | null
  title: string
  price: Money | null
}

export interface PriceVariant {
  id: string
  productId: string
  sku: string | null
  productStatus: string | null
  stock: StockState
  /** Base price in the market currency. */
  price: number | null
}

export interface PriceAction {
  olxId: string
  variantId: string
  productId: string
  sku: string | null
  title: string
  from: Money
  to: Money
  /** Absolute change in percent of the OLX price. */
  changePercent: number
  /** Above the threshold: waits for a person. */
  held: boolean
}

export interface PricePlan {
  skipped: null | "incomplete_read" | "no_catalog"
  actions: PriceAction[]
  /** Live linked adverts skipped because the variant has no base price in the market currency. */
  noPrice: number
  /** Live linked adverts with a price in another currency (or no price at all). */
  otherCurrency: number
}

export function planPrices(input: {
  adverts: readonly PriceAdvert[]
  variants: ReadonlyMap<string, PriceVariant>
  currency: string
  maxChangePercent: number
  readComplete: boolean
  catalogComplete: boolean
}): PricePlan {
  if (!input.readComplete) return { skipped: "incomplete_read", actions: [], noPrice: 0, otherCurrency: 0 }
  if (!input.catalogComplete) return { skipped: "no_catalog", actions: [], noPrice: 0, otherCurrency: 0 }
  const currency = input.currency.trim().toUpperCase()
  const actions: PriceAction[] = []
  let noPrice = 0
  let otherCurrency = 0
  for (const a of input.adverts) {
    if (a.status !== "active" || !a.variantId) continue
    const v = input.variants.get(a.variantId)
    if (!v || !isPublished(v.productStatus) || !hasStock(v.stock)) continue
    if (!a.price || a.price.currency.toUpperCase() !== currency) {
      otherCurrency += 1
      continue
    }
    if (v.price === null) {
      noPrice += 1
      continue
    }
    const target = round2(v.price)
    if (samePrice(a.price.value, target)) continue
    const from = round2(a.price.value)
    const changePercent = from > 0 ? round2((Math.abs(target - from) / from) * 100) : 100
    actions.push({
      olxId: a.olxId,
      variantId: v.id,
      productId: v.productId,
      sku: v.sku,
      title: a.title,
      from: { value: from, currency },
      to: { value: target, currency },
      changePercent,
      held: changePercent > input.maxChangePercent,
    })
  }
  actions.sort((x, y) => x.olxId.localeCompare(y.olxId))
  return { skipped: null, actions, noPrice, otherCurrency }
}

/* ------------------------------------------------------------------ */
/* The PUT body, rebuilt from GET /adverts/{id}                        */
/* ------------------------------------------------------------------ */

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function nonEmpty(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v !== "string") return null
  const s = v.trim()
  return s ? s : null
}

function intOrNull(v: unknown): number | null {
  const n = Number(v)
  return v !== null && v !== undefined && v !== "" && Number.isInteger(n) && n > 0 ? n : null
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** The advert object of `GET /adverts/{id}`: `{ data: {...} }`, or the object itself. */
export function advertData(raw: unknown): Record<string, unknown> | null {
  const o = obj(raw)
  if (!o) return null
  const inner = obj(o.data)
  return inner ?? o
}

/** Current price of a full advert, if it has one. */
export function advertPrice(raw: unknown): Money | null {
  const a = advertData(raw)
  const p = obj(a?.price)
  if (!p) return null
  const value = Number(p.value)
  const currency = typeof p.currency === "string" ? p.currency.trim().toUpperCase() : ""
  return Number.isFinite(value) && currency ? { value, currency } : null
}

export function advertStatus(raw: unknown): string | null {
  const a = advertData(raw)
  return a && typeof a.status === "string" ? a.status : null
}

function attributesForPut(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return []
  const out: Array<Record<string, unknown>> = []
  for (const item of v) {
    const a = obj(item)
    const code = nonEmpty(a?.code)
    if (!a || !code) continue
    const entry: Record<string, unknown> = { code }
    if (Array.isArray(a.values) && a.values.length > 0) {
      entry.values = a.values.map((x) => String(x))
    } else {
      const value = nonEmpty(a.value)
      if (value === null) continue
      entry.value = value
    }
    out.push(entry)
  }
  return out
}

/**
 * The body of `PUT /adverts/{id}` with a new price value. Every other field
 * is copied from the advert as OLX returned it. Returns an error instead of a
 * partial body when a required field is missing.
 */
export function buildPriceUpdateBody(
  raw: unknown,
  newValue: number,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const a = advertData(raw)
  if (!a) return { ok: false, error: "OLX returned no advert to update." }
  const title = nonEmpty(a.title)
  const description = typeof a.description === "string" && a.description.trim() ? a.description : null
  const categoryId = intOrNull(a.category_id)
  const advertiserType = a.advertiser_type === "private" || a.advertiser_type === "business" ? a.advertiser_type : null
  const contact = obj(a.contact)
  const contactName = nonEmpty(contact?.name)
  const location = obj(a.location) ?? obj(contact?.location)
  const cityId = intOrNull(location?.city_id)
  const price = obj(a.price)
  const missing: string[] = []
  if (!title) missing.push("title")
  if (!description) missing.push("description")
  if (!categoryId) missing.push("category_id")
  if (!advertiserType) missing.push("advertiser_type")
  if (!contactName) missing.push("contact.name")
  if (!cityId) missing.push("location.city_id")
  if (!price) missing.push("price")
  if (missing.length > 0) return { ok: false, error: `The advert read from OLX lacks ${missing.join(", ")}, so it cannot be sent back safely.` }

  const body: Record<string, unknown> = {
    title,
    description,
    category_id: categoryId,
    advertiser_type: advertiserType,
  }
  const externalUrl = nonEmpty(a.external_url)
  if (externalUrl) body.external_url = externalUrl
  const externalId = nonEmpty(a.external_id)
  if (externalId) body.external_id = externalId

  const contactBody: Record<string, unknown> = { name: contactName }
  const phone = nonEmpty(contact?.phone)
  if (phone) contactBody.phone = phone
  body.contact = contactBody

  const locationBody: Record<string, unknown> = { city_id: cityId }
  const districtId = intOrNull(location?.district_id)
  if (districtId) locationBody.district_id = districtId
  const lat = numOrNull(location?.latitude)
  const lon = numOrNull(location?.longitude)
  if (lat !== null && lon !== null) {
    locationBody.latitude = lat
    locationBody.longitude = lon
  }
  body.location = locationBody

  if (Array.isArray(a.images)) {
    const images = a.images.map((i) => nonEmpty(obj(i)?.url)).filter((u): u is string => Boolean(u)).map((url) => ({ url }))
    if (images.length > 0) body.images = images
  }

  const priceBody: Record<string, unknown> = {
    value: round2(newValue),
    currency: typeof price?.currency === "string" ? price.currency.trim().toUpperCase() : undefined,
  }
  for (const flag of ["negotiable", "trade", "budget"] as const) {
    if (typeof price?.[flag] === "boolean") priceBody[flag] = price[flag]
  }
  if (!priceBody.currency) return { ok: false, error: "The advert price has no currency." }
  body.price = priceBody

  body.attributes = attributesForPut(a.attributes)
  if (typeof a.courier === "boolean") body.courier = a.courier
  const delivery = obj(a.ad_delivery)
  if (delivery && Array.isArray(delivery.delivery_package_ids) && delivery.delivery_package_ids.length > 0) {
    body.ad_delivery = { delivery_package_ids: delivery.delivery_package_ids.map((x) => String(x)) }
  }
  const psr = obj(a.product_safety_regulation)
  if (psr && Object.keys(psr).length > 0) body.product_safety_regulation = psr
  return { ok: true, body }
}
