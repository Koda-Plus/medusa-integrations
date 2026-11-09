/**
 * WHAT AN OFFER LOOKS LIKE ON THE WIRE: the seller API's `OfferProposal`
 * (create) and `OfferPatch` (merge patch of a closed or pending offer),
 * OpenAPI 1.7.6. Amounts here are the API's decimals, not minor units.
 */

import type { VariantFacts } from "./eligibility"

export type ApiMoney = { amount: number; currency: string }

export interface ApiAddress {
  street: string
  building: string
  flat?: string
  city: string
  postCode: string
  countryCode: string
}

export interface ApiGpsr {
  manufacturer?: {
    name: string
    email: string
    phone?: string
    countryCode?: string
    address?: ApiAddress
    unstructuredAddress?: string
  }
  manuals?: Array<{ title: string; url: string }>
  /** Products placed on the EU market before 13 December 2024. */
  doesNotRequireGpsrInfo?: boolean
  safetyInformation?: string
  batchNumber?: string
  ceMarking?: boolean
}

export interface ApiProduct {
  name: string
  description: string
  brand: string
  categoryId: string
  attributes?: Array<{ id: string; lang?: string; values: string[] }>
  model?: string
  superModel?: string
  sku?: string
  manufacturerProductNumber?: string
  ean?: string
  /** Millimetres and grams, all four or none. */
  dimension?: { width: number; height: number; length: number; weight: number }
}

export interface OfferProposal {
  externalId: string
  product: ApiProduct
  stock: { quantity: number; unit: "UNIT" | "PAIR" | "SET" | "OTHER" }
  price: { grossPrice: ApiMoney; taxRateInfo: string; deposits?: Array<{ quantity: number; depositType: { id: string; price: ApiMoney } }> }
  gpsr?: ApiGpsr
  shippingTime: { daysToShip: number }
  images: Array<{ fileName: string; fileUrl: string; priority: number }>
  postSale?: { returnPolicy?: { description: string }; complaintPolicy?: { description: string } }
  affiliationProductUrl?: string
}

/** A merge patch: only what changes. `externalId` cannot change. */
export type OfferPatchBody = Partial<Omit<OfferProposal, "externalId" | "product">> & { product?: Partial<ApiProduct> }

/* ------------------------------------------------------------------ */
/* Building one                                                        */
/* ------------------------------------------------------------------ */

export interface ProposalInput {
  /** The offer row: what the plugin decided (title, keys, channel price, stock, attributes). */
  row: {
    variant_id: string
    title: string | null
    sku: string | null
    ean: string | null
    brand: string | null
    mpn: string | null
    price_minor: number | null
    stock: number | null
    attributes?: unknown
  }
  facts: Pick<VariantFacts, "description" | "images" | "dimension" | "manufacturer" | "gpsrExempt" | "vatRate">
  categoryId: string
  /** The category needs no GPSR data. */
  gpsrFree: boolean
  defaults: { daysToShip: number; returnPolicy: string; complaintPolicy: string }
  /** The VAT rate when the product names none. */
  vatRate: number
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " }

/** Plain text from a description that may hold HTML: block tags become line breaks, other tags go. */
export function plainText(v: string | null | undefined, max = 100_000): string {
  if (!v) return ""
  return v
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, e: string) => ENTITIES[e] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max)
}

/** "+48501606802" when the value is a phone the API accepts (`^\+\d{3,15}$`), else nothing. */
export function apiPhone(v: string | null | undefined): string | undefined {
  if (!v) return undefined
  let s = v.replace(/[\s().-]/g, "")
  if (/^00\d+$/.test(s)) s = `+${s.slice(2)}`
  if (/^\d{9}$/.test(s)) s = `+48${s}`
  return /^\+\d{3,15}$/.test(s) ? s : undefined
}

/** A file name the API accepts (5 to 500 characters) from an image URL. */
export function fileNameOf(url: string, i: number): string {
  let base = ""
  try {
    base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
  } catch {
    base = ""
  }
  base = base.replace(/[^\w.-]+/g, "-").slice(-200)
  return base.length >= 5 ? base : `image-${i + 1}.jpg`
}

function attributesOf(v: unknown): Array<{ id: string; values: string[] }> {
  if (!Array.isArray(v)) return []
  return v
    .filter((a): a is { id: unknown; values: unknown } => Boolean(a) && typeof a === "object")
    .map((a) => ({ id: typeof a.id === "string" ? a.id : "", values: (Array.isArray(a.values) ? a.values : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 50) }))
    .filter((a) => a.id && a.values.length > 0)
    .slice(0, 120)
}

/**
 * The merge patch of an edit: only what "Edit offer" and the category
 * parameters can change (the name, the description, the dimension, the
 * parameters, the photos, the days to ship), taken from the full proposal so
 * the values are shaped exactly as a listing shapes them. Price and stock
 * are left out: the price and stock sync owns them. A merge patch keeps
 * what it does not name, so an offer without dimensions keeps its own.
 */
export function editPatchOf(p: OfferProposal): OfferPatchBody {
  return {
    product: {
      name: p.product.name,
      description: p.product.description,
      // The category goes too: a PENDING offer refused with CATEGORY_INCORRECT
      // is fixed by a patch (stage 09.11.2026 took it and answered with the offer).
      categoryId: p.product.categoryId,
      ...(p.product.dimension ? { dimension: p.product.dimension } : {}),
      ...(p.product.attributes ? { attributes: p.product.attributes } : {}),
    },
    images: p.images,
    shippingTime: p.shippingTime,
  }
}

/** Whether a patch changes more than the price and the stock (what a published offer may refuse). */
export function patchTouchesContent(patch: OfferPatchBody): boolean {
  return Object.keys(patch).some((k) => k !== "price" && k !== "stock")
}

/**
 * The `OfferProposal` of one offer. The caller has checked eligibility: here
 * every value is only shaped to the API's limits (lengths, units, money).
 */
export function buildProposal(input: ProposalInput): OfferProposal {
  const { row, facts } = input
  const manufacturer = facts.manufacturer
  const gpsr: ApiGpsr | undefined = input.gpsrFree
    ? undefined
    : facts.gpsrExempt
      ? { doesNotRequireGpsrInfo: true }
      : manufacturer && manufacturer.email
        ? {
            manufacturer: {
              name: manufacturer.name.slice(0, 500),
              email: manufacturer.email.slice(0, 500),
              ...(apiPhone(manufacturer.phone) ? { phone: apiPhone(manufacturer.phone) } : {}),
              ...(manufacturer.address ? { unstructuredAddress: manufacturer.address.slice(0, 300) } : {}),
            },
          }
        : undefined
  const attributes = attributesOf(row.attributes)
  const ean = row.ean?.replace(/\D/g, "") || undefined
  const policies = {
    ...(input.defaults.returnPolicy ? { returnPolicy: { description: input.defaults.returnPolicy } } : {}),
    ...(input.defaults.complaintPolicy ? { complaintPolicy: { description: input.defaults.complaintPolicy } } : {}),
  }
  return {
    externalId: row.variant_id,
    product: {
      name: (row.title ?? "").trim().slice(0, 150),
      description: plainText(facts.description),
      brand: (row.brand ?? "").trim().slice(0, 100),
      categoryId: input.categoryId,
      ...(attributes.length ? { attributes: attributes.map((a) => ({ id: a.id, lang: "pl", values: a.values })) } : {}),
      ...(row.sku ? { sku: row.sku.slice(0, 100) } : {}),
      ...(row.mpn ? { manufacturerProductNumber: row.mpn.slice(0, 255) } : {}),
      ...(ean ? { ean: ean.slice(0, 14) } : {}),
      ...(facts.dimension ? { dimension: facts.dimension } : {}),
    },
    stock: { quantity: Math.max(0, Math.min(999_999, Math.round(Number(row.stock) || 0))), unit: "UNIT" },
    price: { grossPrice: { amount: Math.round(Number(row.price_minor) || 0) / 100, currency: "PLN" }, taxRateInfo: `${facts.vatRate ?? input.vatRate}%` },
    ...(gpsr ? { gpsr } : {}),
    shippingTime: { daysToShip: Math.max(0, Math.min(60, Math.round(input.defaults.daysToShip))) },
    images: facts.images.slice(0, 20).map((url, i) => ({ fileName: fileNameOf(url, i), fileUrl: url, priority: i + 1 })),
    ...(Object.keys(policies).length ? { postSale: policies } : {}),
  }
}
