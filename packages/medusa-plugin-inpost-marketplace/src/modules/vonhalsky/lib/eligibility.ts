/**
 * CAN THIS VARIANT BE LISTED? Pure checks over the facts read from Medusa
 * (and the compliance plugin when it is installed). Each missing piece is a
 * stable code the admin translates, so a person sees exactly what to fix.
 *
 * The marketplace matches offers by EAN, brand and manufacturer part number,
 * and asks for GPSR manufacturer data (the public SDK's `GpsrInfo` and
 * `Manufacturer` models: a name and an e-mail, an address). What blocks a
 * listing here is what an offer cannot go out without; what only weakens it
 * is a warning.
 */

import type { GpsrManufacturer } from "./gpsr"

export const BLOCKING_REASONS = ["no_title", "no_ean", "invalid_ean", "no_brand", "no_gpsr", "gpsr_incomplete", "no_price", "not_published"] as const
export type BlockingReason = (typeof BLOCKING_REASONS)[number]

export const WARNING_CODES = ["no_mpn", "no_stock", "no_image"] as const
export type WarningCode = (typeof WARNING_CODES)[number]

export interface VariantFacts {
  variantId: string
  productId: string
  sku: string | null
  title: string | null
  thumbnail: string | null
  /** Medusa's product status: only "published" products are offered. */
  productStatus: string | null
  ean: string | null
  brand: string | null
  mpn: string | null
  manufacturer: GpsrManufacturer | null
  gpsrSource: "compliance" | "metadata" | null
  /** The Medusa PLN price in minor units, null without a PLN price. */
  basePriceMinor: number | null
  stock: number
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

export interface Eligibility {
  reasons: BlockingReason[]
  warnings: WarningCode[]
  listable: boolean
}

export function eligibility(f: VariantFacts): Eligibility {
  const reasons: BlockingReason[] = []
  const warnings: WarningCode[] = []
  if (!f.title || !f.title.trim()) reasons.push("no_title")
  if (f.productStatus && f.productStatus !== "published") reasons.push("not_published")
  const ean = normalizeEan(f.ean)
  if (!ean) reasons.push("no_ean")
  else if (!validGtin(ean)) reasons.push("invalid_ean")
  if (!f.brand || !f.brand.trim()) reasons.push("no_brand")
  if (!f.manufacturer) reasons.push("no_gpsr")
  else if (!f.manufacturer.name || !f.manufacturer.email || !f.manufacturer.address) reasons.push("gpsr_incomplete")
  if (f.basePriceMinor === null || !(f.basePriceMinor > 0)) reasons.push("no_price")
  if (!f.mpn || !f.mpn.trim()) warnings.push("no_mpn")
  if (!(f.stock > 0)) warnings.push("no_stock")
  if (!f.thumbnail) warnings.push("no_image")
  return { reasons, warnings, listable: reasons.length === 0 }
}

/**
 * The status an offer row should have after its facts were read again:
 * a blocked offer that is fixed goes back to draft (never straight to
 * listed: a person lists it), a listed one that lost a required field is
 * blocked, closed stays closed.
 */
export function nextOfferStatus(current: string | null, listable: boolean): "draft" | "listed" | "blocked" | "closed" {
  if (current === "closed") return "closed"
  if (!listable) return "blocked"
  if (current === "listed") return "listed"
  return "draft"
}
