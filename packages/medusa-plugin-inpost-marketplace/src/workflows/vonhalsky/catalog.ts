/**
 * THE MEDUSA SIDE OF AN OFFER: the variants with their matching keys, the
 * PLN price, the stock, the description, the images, the categories, the
 * package dimensions and the GPSR manufacturer (from the EU
 * Compliance plugin when its module is in the container, else from product
 * metadata). Read through Query; nothing is written.
 */

import type { VariantFacts } from "../../modules/vonhalsky/lib/eligibility"
import { normalizeEan } from "../../modules/vonhalsky/lib/eligibility"
import { fromCompliance, fromMetadata, pickManufacturer, type GpsrManufacturer } from "../../modules/vonhalsky/lib/gpsr"
import type { ResolvedVonHalskyOptions } from "../../modules/vonhalsky/lib/options"
import { imageAccepted, type OfferDimension } from "../../modules/vonhalsky/lib/overrides"
import { toMinor } from "../../modules/vonhalsky/lib/pricing"
import { availableQuantity, type VariantStock } from "../../modules/vonhalsky/lib/stock"
import type { Scope } from "../../modules/vonhalsky/lib/store"
import { queryOf, type QueryLike } from "./runtime"

/** At most this many variants are read in one refresh. */
export const CATALOG_MAX = 5000
const PAGE = 200

interface VariantRecord {
  id: string
  sku?: string | null
  title?: string | null
  ean?: string | null
  barcode?: string | null
  upc?: string | null
  product_id?: string | null
  manage_inventory?: boolean | null
  metadata?: Record<string, unknown> | null
  weight?: number | string | null
  length?: number | string | null
  height?: number | string | null
  width?: number | string | null
  product?: {
    title?: string | null
    status?: string | null
    thumbnail?: string | null
    description?: string | null
    metadata?: Record<string, unknown> | null
    weight?: number | string | null
    length?: number | string | null
    height?: number | string | null
    width?: number | string | null
    images?: Array<{ url?: string | null; rank?: number | null } | null> | null
    categories?: Array<{ id?: string | null } | null> | null
  } | null
  inventory_items?: Array<{
    required_quantity?: number | string | null
    inventory?: { location_levels?: Array<{ location_id?: string | null; stocked_quantity?: number | string | null; reserved_quantity?: number | string | null } | null> | null } | null
  } | null> | null
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null)

function meta(raw: VariantRecord, key: string): string | null {
  return str(raw.metadata?.[key]) ?? str(raw.product?.metadata?.[key])
}

function stockOf(raw: VariantRecord): VariantStock {
  return {
    manageInventory: raw.manage_inventory !== false,
    items: (raw.inventory_items ?? [])
      .filter((i): i is NonNullable<typeof i> => Boolean(i))
      .map((i) => ({
        requiredQuantity: Number(i.required_quantity ?? 1) || 1,
        levels: (i.inventory?.location_levels ?? [])
          .filter((l): l is NonNullable<typeof l> => Boolean(l))
          .map((l) => ({ locationId: String(l.location_id ?? ""), stocked: Number(l.stocked_quantity ?? 0) || 0, reserved: Number(l.reserved_quantity ?? 0) || 0 })),
      })),
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Package dimensions in mm and g from the variant, else the product; all four or none (the marketplace takes all or nothing). */
export function dimensionOf(raw: Pick<VariantRecord, "weight" | "length" | "height" | "width" | "product">, units: { dimensionUnit: "mm" | "cm"; weightUnit: "g" | "kg" }): VariantFacts["dimension"] {
  const side = (k: "length" | "height" | "width") => num(raw[k]) ?? num(raw.product?.[k])
  const w = side("width")
  const h = side("height")
  const l = side("length")
  const g = num(raw.weight) ?? num(raw.product?.weight)
  if (w === null || h === null || l === null || g === null) return null
  const mm = (x: number) => Math.max(1, Math.round(units.dimensionUnit === "cm" ? x * 10 : x))
  return { width: mm(w), height: mm(h), length: mm(l), weight: Math.max(1, Math.round(units.weightUnit === "kg" ? g * 1000 : g)) }
}

/** A VAT rate like 23, "8" or "5%"; null when absent or not a rate. */
export function vatOf(v: unknown): number | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v.replace("%", "").trim() : ""
  const n = Number(s.replace(",", "."))
  return s && Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

/* The format filter lives with the overrides: photos a person sets pass the same rule. */
export { imageAccepted }

/** The images in Medusa's order with the thumbnail first, http(s) only, in formats the marketplace takes, at most 20 (the marketplace's limit). */
export function imagesOf(product: VariantRecord["product"]): string[] {
  const list = [...(product?.images ?? [])]
    .filter((i): i is NonNullable<typeof i> => Boolean(i && i.url))
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((i) => String(i.url))
  const thumb = str(product?.thumbnail)
  const all = [...(thumb ? [thumb] : []), ...list]
  return [...new Set(all)].filter((u) => /^https?:\/\//i.test(u) && imageAccepted(u)).slice(0, 20)
}

/**
 * The offer name: the product title, with the variant title after it only
 * when the product has more variants to tell apart ("Bluza z kapturem M").
 * A product with one variant ("Standard", "Default variant") is just its title.
 */
export function offerTitle(productTitle: string | null, variantTitle: string | null, variantCount: number | null): string | null {
  if (!productTitle) return variantTitle
  if (!variantTitle || variantCount === 1 || variantTitle.toLowerCase() === "default variant" || variantTitle === productTitle) return productTitle
  return `${productTitle} ${variantTitle}`
}

/**
 * How many variants each product has (deleted ones not counted), read from the
 * products themselves: a variant's own `product.variants` does not come back
 * through the query graph. A product that could not be read is missing.
 */
export async function variantCountsOf(query: QueryLike, productIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < productIds.length; i += PAGE) {
    const chunk = productIds.slice(i, i + PAGE)
    try {
      const { data } = await query.graph({ entity: "product", fields: ["id", "variants.id"], filters: { id: [...chunk] } })
      for (const p of data as Array<{ id: string; variants?: Array<{ id?: string | null } | null> | null }>) out.set(p.id, (p.variants ?? []).filter((v) => v && v.id).length)
    } catch {
      /* without the count the variant title stays in the name */
    }
  }
  return out
}

/** The default PLN price per variant (no price list, no rules, no quantity tier), in minor units. */
export async function plnPrices(query: QueryLike, ids: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < ids.length; i += PAGE) {
    const chunk = ids.slice(i, i + PAGE)
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "prices.amount", "prices.currency_code", "prices.price_list_id", "prices.min_quantity", "prices.rules_count"],
      filters: { id: [...chunk] },
    })
    for (const raw of data as Array<{ id: string; prices?: Array<Record<string, unknown> | null> | null }>) {
      for (const p of raw.prices ?? []) {
        if (!p || String(p.currency_code ?? "").toLowerCase() !== "pln" || p.price_list_id) continue
        if (Number(p.rules_count ?? 0) > 0 || (p.min_quantity !== null && p.min_quantity !== undefined && Number(p.min_quantity) > 1)) continue
        const minor = toMinor(p.amount)
        if (minor !== null && !out.has(raw.id)) out.set(raw.id, minor)
      }
    }
  }
  return out
}

/** Whether Medusa's PLN prices include tax: the option, else the PLN price preference (none: net, Medusa's default). */
export async function plnIncludesTax(query: QueryLike, option: boolean | null): Promise<boolean> {
  if (option !== null) return option
  try {
    const { data } = await query.graph({ entity: "price_preference", fields: ["id", "is_tax_inclusive"], filters: { attribute: "currency_code", value: "pln" } })
    return (data as Array<{ is_tax_inclusive?: boolean | null }>).some((p) => p.is_tax_inclusive === true)
  } catch {
    return false
  }
}

/** Whether the EU Compliance module of Koda Plus is in the container. */
export function complianceOf(scope: Scope): any | null {
  try {
    const svc = scope.resolve("compliance") as any
    return svc && typeof svc.listComplianceProducts === "function" ? svc : null
  } catch {
    return null
  }
}

/** The GPSR manufacturer per product id from the compliance plugin's records. Empty without the plugin. */
export async function complianceManufacturers(scope: Scope, productIds: readonly string[]): Promise<Map<string, GpsrManufacturer>> {
  const out = new Map<string, GpsrManufacturer>()
  const svc = complianceOf(scope)
  if (!svc || productIds.length === 0) return out
  try {
    for (let i = 0; i < productIds.length; i += PAGE) {
      const records = ((await svc.listComplianceProducts({ product_id: productIds.slice(i, i + PAGE) }, { take: PAGE * 2 })) ?? []) as Array<{ product_id: string; manufacturer_id?: string | null }>
      const opIds = [...new Set(records.map((r) => r.manufacturer_id).filter((x): x is string => Boolean(x)))]
      if (opIds.length === 0) continue
      const ops = ((await svc.listComplianceOperators({ id: opIds }, { take: opIds.length })) ?? []) as Array<Record<string, unknown> & { id: string }>
      const byId = new Map(ops.map((o) => [o.id, fromCompliance(o as never)]))
      for (const r of records) {
        const m = r.manufacturer_id ? byId.get(r.manufacturer_id) : null
        if (m) out.set(r.product_id, m)
      }
    }
  } catch {
    /* the compliance plugin is optional: metadata still counts */
  }
  return out
}

export interface CatalogRead {
  facts: VariantFacts[]
  thumbnails: Map<string, string | null>
  /** Every page was read: only then may offers of vanished variants be closed. */
  complete: boolean
  includesTax: boolean
}

/** The variants (all, or the given ones) as offer facts. */
export async function loadFacts(scope: Scope, o: ResolvedVonHalskyOptions, only: { variantIds?: string[]; productIds?: string[] } = {}): Promise<CatalogRead> {
  const query = queryOf(scope)
  const records: VariantRecord[] = []
  const filters: Record<string, unknown> = {}
  if (only.variantIds?.length) filters.id = only.variantIds
  if (only.productIds?.length) filters.product_id = only.productIds
  let complete = true
  for (let skip = 0; ; skip += PAGE) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "sku",
        "title",
        "ean",
        "barcode",
        "upc",
        "product_id",
        "manage_inventory",
        "metadata",
        "weight",
        "length",
        "height",
        "width",
        "product.title",
        "product.status",
        "product.thumbnail",
        "product.description",
        "product.metadata",
        "product.weight",
        "product.length",
        "product.height",
        "product.width",
        "product.images.url",
        "product.images.rank",
        "product.categories.id",
        "inventory_items.required_quantity",
        "inventory_items.inventory.location_levels.location_id",
        "inventory_items.inventory.location_levels.stocked_quantity",
        "inventory_items.inventory.location_levels.reserved_quantity",
      ],
      filters,
      pagination: { skip, take: PAGE, order: { id: "ASC" } },
    })
    records.push(...(data as VariantRecord[]))
    if (data.length < PAGE) break
    if (records.length >= CATALOG_MAX) {
      complete = false
      break
    }
  }
  const usable = records.filter((r) => r.product_id)
  const ids = usable.map((r) => r.id)
  const productIds = [...new Set(usable.map((r) => String(r.product_id)))]
  const [prices, gpsr, includesTax, variantCounts] = await Promise.all([plnPrices(query, ids), complianceManufacturers(scope, productIds), plnIncludesTax(query, o.pricesIncludeTax), variantCountsOf(query, productIds)])
  const thumbnails = new Map<string, string | null>()
  const facts: VariantFacts[] = usable.map((r) => {
    const productTitle = str(r.product?.title)
    const variantTitle = str(r.title)
    const title = offerTitle(productTitle, variantTitle, variantCounts.get(String(r.product_id)) ?? null)
    const picked = pickManufacturer(gpsr.get(String(r.product_id)) ?? null, fromMetadata(r.product?.metadata ?? null) ?? fromMetadata(r.metadata ?? null))
    thumbnails.set(r.id, str(r.product?.thumbnail))
    return {
      variantId: r.id,
      productId: String(r.product_id),
      sku: str(r.sku),
      title,
      thumbnail: str(r.product?.thumbnail),
      images: imagesOf(r.product),
      description: str(r.product?.description),
      productStatus: str(r.product?.status),
      ean: normalizeEan(r.ean) ?? normalizeEan(r.barcode) ?? normalizeEan(meta(r, o.eanKey)),
      brand: meta(r, o.brandKey),
      mpn: meta(r, o.mpnKey),
      manufacturer: picked.manufacturer,
      gpsrSource: picked.source,
      gpsrExempt: [r.metadata?.gpsr_exempt, r.product?.metadata?.gpsr_exempt].some((v) => v === true || v === "true"),
      categoryIds: (r.product?.categories ?? []).map((c) => str(c?.id)).filter((x): x is string => Boolean(x)),
      dimension: dimensionOf(r, o),
      vatRate: vatOf(meta(r, o.vatKey)),
      basePriceMinor: prices.get(r.id) ?? null,
      stock: availableQuantity(stockOf(r), o.stockLocationIds, o.untrackedStock),
    }
  })
  return { facts, thumbnails, complete: complete && !only.variantIds?.length && !only.productIds?.length, includesTax }
}

/** What Medusa says about the fields an offer edit can override: the placeholders of the edit form and the base of the effective values. */
export interface EditableFacts {
  title: string | null
  description: string | null
  images: string[]
  dimension: OfferDimension | null
}

/**
 * The editable facts of the given variants (one page of the offers list):
 * the name, the description, the photos and the package, read the same way
 * as `loadFacts` reads them, without prices, stock or GPSR. A variant that
 * could not be read is missing: the list then shows the overrides alone.
 */
export async function editableFactsOf(scope: Scope, o: Pick<ResolvedVonHalskyOptions, "dimensionUnit" | "weightUnit">, variantIds: readonly string[]): Promise<Map<string, EditableFacts>> {
  const out = new Map<string, EditableFacts>()
  if (variantIds.length === 0) return out
  try {
    const query = queryOf(scope)
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "title", "product_id", "weight", "length", "height", "width", "product.title", "product.thumbnail", "product.description", "product.weight", "product.length", "product.height", "product.width", "product.images.url", "product.images.rank"],
      filters: { id: [...variantIds] },
    })
    const records = data as VariantRecord[]
    const counts = await variantCountsOf(query, [...new Set(records.map((r) => String(r.product_id ?? "")).filter(Boolean))])
    for (const r of records) {
      out.set(r.id, {
        title: offerTitle(str(r.product?.title), str(r.title), counts.get(String(r.product_id)) ?? null),
        description: str(r.product?.description),
        images: imagesOf(r.product),
        dimension: dimensionOf(r, o),
      })
    }
  } catch {
    /* the list still shows the overrides */
  }
  return out
}

/** Product thumbnails of the given variants, for the offers list. */
export async function thumbnailsOf(scope: Scope, variantIds: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (variantIds.length === 0) return out
  try {
    const { data } = await queryOf(scope).graph({ entity: "product_variant", fields: ["id", "product.thumbnail"], filters: { id: [...variantIds] } })
    for (const v of data as Array<{ id: string; product?: { thumbnail?: string | null } | null }>) out.set(v.id, str(v.product?.thumbnail))
  } catch {
    /* the list still shows the titles */
  }
  return out
}
