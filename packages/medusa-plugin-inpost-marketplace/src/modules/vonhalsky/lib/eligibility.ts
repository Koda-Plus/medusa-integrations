/**
 * CAN THIS VARIANT BE LISTED? Pure checks over the facts read from Medusa
 * (and the compliance plugin when it is installed). Each missing piece is a
 * stable code the admin translates, so a person sees exactly what to fix.
 *
 * What the seller API requires of an offer (OpenAPI 1.7.6, guidelines):
 * a name, a description, a brand, a leaf category, at least one image, an
 * EAN or else the brand with the manufacturer part number, a gross price,
 * and GPSR manufacturer data (a name and an e-mail) unless the category is
 * outside GPSR or the product was on the EU market before 13 December 2024.
 * Package dimensions are optional, but each side is at most 1200 mm and the
 * three together at most 2200 mm. Required attributes of the category are
 * checked when the category's definitions were read.
 */

import type { GpsrManufacturer } from "./gpsr"
import { plainText } from "./offer-payload"

export const BLOCKING_REASONS = [
  "no_title",
  "title_invalid",
  "no_ean",
  "invalid_ean",
  "no_brand",
  "no_description",
  "description_short",
  "no_image",
  "no_category",
  "attributes_missing",
  "no_gpsr",
  "gpsr_incomplete",
  "too_large",
  "no_price",
  "not_published",
] as const
export type BlockingReason = (typeof BLOCKING_REASONS)[number]

export const WARNING_CODES = ["no_mpn", "no_stock", "no_dimensions", "one_image"] as const
export type WarningCode = (typeof WARNING_CODES)[number]

export interface VariantFacts {
  variantId: string
  productId: string
  sku: string | null
  title: string | null
  thumbnail: string | null
  /** Image URLs in order (the thumbnail first), at most 20. */
  images: string[]
  description: string | null
  /** Medusa's product status: only "published" products are offered. */
  productStatus: string | null
  ean: string | null
  brand: string | null
  mpn: string | null
  manufacturer: GpsrManufacturer | null
  gpsrSource: "compliance" | "metadata" | null
  /** The product was on the EU market before 13 December 2024 (metadata `gpsr_exempt`). */
  gpsrExempt: boolean
  /** Medusa category ids of the product. */
  categoryIds: string[]
  /** Package dimensions in mm and weight in g, null when unknown. */
  dimension: { width: number; height: number; length: number; weight: number } | null
  /** A per product VAT rate (percent), null for the default. */
  vatRate: number | null
  /** The Medusa PLN price in minor units, null without a PLN price. */
  basePriceMinor: number | null
  stock: number
}

/** What the offer row adds to the facts: the chosen category and its definitions, the attribute values. */
export interface OfferContext {
  categoryId: string | null
  /** The category needs no GPSR data. */
  gpsrFree: boolean
  /** Required attribute ids of the category; null while unknown (not read yet). */
  requiredAttributes: string[] | null
  attributes: Array<{ id: string; values: string[] }>
}

/** Digits only, or null. Spaces and dashes people type are dropped. */
export function normalizeEan(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null
  const s = String(value).replace(/[\s-]/g, "")
  return s ? s : null
}

/** A GTIN (EAN-8, UPC-A 12, EAN-13, GTIN-14) with a valid check digit. */
export function validGtin(value: string): boolean {
  if (!/^\d+$/.test(value) || ![8, 12, 13, 14].includes(value.length)) return false
  const digits = value.split("").map(Number)
  const check = digits.pop() as number
  let sum = 0
  digits.reverse().forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)))
  return (10 - (sum % 10)) % 10 === check
}

/** The marketplace's package limits: each side at most 1200 mm, the three at most 2200 mm. */
export function fitsPackage(d: { width: number; height: number; length: number }): boolean {
  return d.width <= 1200 && d.height <= 1200 && d.length <= 1200 && d.width + d.height + d.length <= 2200
}

export interface Eligibility {
  reasons: BlockingReason[]
  warnings: WarningCode[]
  listable: boolean
}

const filled = (v: string | null | undefined): boolean => Boolean(v && v.trim())

/**
 * The marketplace's own validation (merchant instructions 11/2026, "Najczęstsze
 * błędy walidacji"): a name of 7 to 150 characters with at least two words, a
 * description of at least 100 characters of text. Checked here so the offer is
 * fixed before it is sent, not after InPost holds it in PENDING.
 */
export const TITLE_MIN = 7
export const TITLE_MAX = 150
export const DESCRIPTION_MIN = 100

export function titleValid(title: string): boolean {
  const t = title.trim()
  const length = [...t].length
  return length >= TITLE_MIN && length <= TITLE_MAX && t.split(/\s+/).filter(Boolean).length >= 2
}

export function eligibility(f: VariantFacts, ctx: OfferContext = { categoryId: null, gpsrFree: false, requiredAttributes: null, attributes: [] }): Eligibility {
  const reasons: BlockingReason[] = []
  const warnings: WarningCode[] = []
  if (!filled(f.title)) reasons.push("no_title")
  else if (!titleValid(f.title as string)) reasons.push("title_invalid")
  if (f.productStatus && f.productStatus !== "published") reasons.push("not_published")
  const ean = normalizeEan(f.ean)
  /* An EAN, or else the brand with the manufacturer part number. */
  if (ean && !validGtin(ean)) reasons.push("invalid_ean")
  else if (!ean && !filled(f.mpn)) reasons.push("no_ean")
  if (!filled(f.brand)) reasons.push("no_brand")
  /* What the marketplace gets is the text of the HTML: markup alone is no description. */
  const text = f.description ? plainText(f.description) : ""
  if (!filled(text)) reasons.push("no_description")
  else if ([...text.trim()].length < DESCRIPTION_MIN) reasons.push("description_short")
  if (f.images.length === 0) reasons.push("no_image")
  if (!ctx.categoryId) reasons.push("no_category")
  else if (ctx.requiredAttributes) {
    const have = new Set(ctx.attributes.filter((a) => a.values.some((v) => v.trim())).map((a) => a.id))
    if (ctx.requiredAttributes.some((id) => !have.has(id))) reasons.push("attributes_missing")
  }
  if (!ctx.gpsrFree && !f.gpsrExempt) {
    if (!f.manufacturer) reasons.push("no_gpsr")
    else if (!filled(f.manufacturer.name) || !filled(f.manufacturer.email)) reasons.push("gpsr_incomplete")
  }
  if (f.dimension && !fitsPackage(f.dimension)) reasons.push("too_large")
  if (f.basePriceMinor === null || !(f.basePriceMinor > 0)) reasons.push("no_price")
  if (ean && !filled(f.mpn)) warnings.push("no_mpn")
  if (!(f.stock > 0)) warnings.push("no_stock")
  if (!f.dimension) warnings.push("no_dimensions")
  if (f.images.length === 1) warnings.push("one_image")
  return { reasons, warnings, listable: reasons.length === 0 }
}

/**
 * The status an offer row should have after its facts were read again:
 * a blocked offer that is fixed goes back to draft (never straight to
 * listed: a person lists it), closed stays closed. A listed offer stays
 * listed even when a field went missing in Medusa: it is on the marketplace
 * already (its price and stock still sync) and `reasons` shows what to fix.
 */
export function nextOfferStatus(current: string | null, listable: boolean): "draft" | "listed" | "blocked" | "closed" {
  if (current === "closed") return "closed"
  if (!listable) return current === "listed" ? "listed" : "blocked"
  if (current === "listed") return "listed"
  return "draft"
}
