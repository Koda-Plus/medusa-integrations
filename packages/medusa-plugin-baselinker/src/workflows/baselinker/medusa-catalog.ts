/**
 * What the writers need to know about the Medusa catalog, read through
 * Query: products with their variants, base prices, images, categories,
 * tags and options; the category index; whether prices of a currency
 * include tax; the default sales channel and shipping profile.
 *
 * Read only. The catalog import, the card plan and the price push all start
 * from here, so the three see the same numbers.
 */

import type { IFulfillmentModuleService, IPricingModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { tagManufacturer, type MedusaProductLite, type MedusaVariantLite } from "../../modules/baselinker/lib/catalog-import"
import { PRODUCT_METADATA } from "../../modules/baselinker/lib/constants"
import { normalizeEan } from "../../modules/baselinker/lib/matching"
import { round, toNumber, toNumberOrNull } from "../../modules/baselinker/lib/numbers"
import { queryOf, type Scope } from "./runtime"

interface PriceRecord {
  amount?: unknown
  currency_code?: string | null
  rules_count?: unknown
  price_list_id?: string | null
  min_quantity?: unknown
}

interface VariantRecord {
  id: string
  title?: string | null
  sku?: string | null
  ean?: string | null
  barcode?: string | null
  upc?: string | null
  weight?: unknown
  manage_inventory?: boolean | null
  prices?: PriceRecord[] | null
  price_set?: { id?: string | null } | null
}

interface ProductRecord {
  id: string
  title?: string | null
  handle?: string | null
  description?: string | null
  status?: string | null
  thumbnail?: string | null
  metadata?: Record<string, unknown> | null
  images?: Array<{ url?: string | null; rank?: unknown }> | null
  categories?: Array<{ id: string; name?: string | null }> | null
  tags?: Array<{ id: string; value?: string | null }> | null
  options?: Array<{ id: string; title?: string | null; values?: Array<{ value?: string | null }> | null }> | null
  variants?: VariantRecord[] | null
}

/** A Medusa variant with what the card plan and the price push need on top of the import's view. */
export interface MedusaVariantFull extends MedusaVariantLite {
  productTitle: string
  /** Variant title unless it is the default one. */
  variantTitle: string | null
  description: string | null
  images: string[]
  manageInventory: boolean
  priceSetId: string | null
}

export interface MedusaCatalog {
  products: MedusaProductLite[]
  variants: MedusaVariantFull[]
  /** Product metadata as stored, to merge into instead of replacing it. */
  metadata: Map<string, Record<string, unknown>>
}

/** The base price of a currency: no price list, no rules, no quantity tiers. */
export function basePrice(prices: readonly PriceRecord[] | null | undefined, currency: string): number | null {
  const cur = currency.toLowerCase()
  const match = (prices ?? []).find(
    (p) =>
      String(p.currency_code ?? "").toLowerCase() === cur &&
      !p.price_list_id &&
      (toNumberOrNull(p.rules_count) ?? 0) === 0 &&
      (toNumberOrNull(p.min_quantity) ?? 0) <= 1,
  )
  return match ? round(toNumber(match.amount), 2) : null
}

const DEFAULT_TITLES = new Set(["default variant", "default", "domyślny", "domyślny wariant"])

export async function loadMedusaCatalog(
  scope: Scope,
  opts: { currency: string; manufacturerAs: "metadata" | "tag"; knownManufacturers?: ReadonlySet<string> },
): Promise<MedusaCatalog> {
  const query = queryOf(scope)
  const out: MedusaCatalog = { products: [], variants: [], metadata: new Map() }
  const take = 100
  for (let skip = 0; skip < 1_000_000; skip += take) {
    const { data } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "handle",
        "description",
        "status",
        "thumbnail",
        "metadata",
        "images.url",
        "images.rank",
        "categories.id",
        "categories.name",
        "tags.id",
        "tags.value",
        "options.id",
        "options.title",
        "options.values.value",
        "variants.id",
        "variants.title",
        "variants.sku",
        "variants.ean",
        "variants.barcode",
        "variants.upc",
        "variants.weight",
        "variants.manage_inventory",
        "variants.prices.amount",
        "variants.prices.currency_code",
        "variants.prices.rules_count",
        "variants.prices.price_list_id",
        "variants.prices.min_quantity",
        "variants.price_set.id",
      ],
      pagination: { skip, take, order: { id: "ASC" } },
    })
    for (const p of data as ProductRecord[]) {
      const meta = (p.metadata ?? {}) as Record<string, unknown>
      out.metadata.set(p.id, meta)
      const images = [...(p.images ?? [])]
        .filter((i) => i?.url)
        .sort((a, b) => toNumber(a.rank) - toNumber(b.rank))
        .map((i) => i.url as string)
      const manufacturer =
        opts.manufacturerAs === "metadata"
          ? typeof meta[PRODUCT_METADATA.manufacturer] === "string"
            ? (meta[PRODUCT_METADATA.manufacturer] as string)
            : null
          : null
      const blProductId = meta[PRODUCT_METADATA.productId]
      const tags = (p.tags ?? []).filter((t) => t?.id && t.value).map((t) => ({ id: t.id, value: t.value as string }))
      out.products.push({
        id: p.id,
        title: p.title ?? "",
        handle: p.handle ?? null,
        description: p.description ?? null,
        status: p.status ?? "published",
        images: images.length > 0 ? images : p.thumbnail ? [p.thumbnail] : [],
        categoryIds: (p.categories ?? []).map((c) => c.id),
        categoryNames: (p.categories ?? []).map((c) => c.name ?? "").filter(Boolean),
        manufacturer: opts.manufacturerAs === "tag" ? tagManufacturer(tags, opts.knownManufacturers) : manufacturer,
        tags,
        blProductId: typeof blProductId === "string" || typeof blProductId === "number" ? String(blProductId) : null,
        options: (p.options ?? []).map((o) => ({ id: o.id, title: o.title ?? "", values: (o.values ?? []).map((v) => v.value ?? "").filter(Boolean) })),
      })
      for (const v of p.variants ?? []) {
        const title = (v.title ?? "").trim()
        out.variants.push({
          id: v.id,
          productId: p.id,
          sku: v.sku ?? null,
          ean: normalizeEan(v.ean) ?? normalizeEan(v.barcode) ?? normalizeEan(v.upc),
          title: v.title ?? null,
          weight: toNumberOrNull(v.weight),
          price: basePrice(v.prices, opts.currency),
          productTitle: p.title ?? "",
          variantTitle: title && !DEFAULT_TITLES.has(title.toLowerCase()) && title !== p.title ? title : null,
          description: p.description ?? null,
          images,
          manageInventory: v.manage_inventory !== false,
          priceSetId: v.price_set?.id ?? null,
        })
      }
    }
    if (data.length < take) break
  }
  return out
}

/** Medusa categories by lowercased name (the first one wins when two share a name). */
export async function loadCategoryIndex(scope: Scope): Promise<Map<string, string>> {
  const { data } = await queryOf(scope).graph({ entity: "product_category", fields: ["id", "name"], pagination: { take: 5000, skip: 0 } })
  const out = new Map<string, string>()
  for (const c of data as Array<{ id: string; name?: string | null }>) {
    const key = (c.name ?? "").trim().toLowerCase()
    if (key && !out.has(key)) out.set(key, c.id)
  }
  return out
}

/** Whether Medusa prices of a currency include tax (Settings, price preferences). Medusa's default is no. */
export async function pricesIncludeTax(scope: Scope, currency: string): Promise<boolean> {
  try {
    const pricing = (scope as { resolve<T>(k: string): T }).resolve<IPricingModuleService>(Modules.PRICING)
    const prefs = await pricing.listPricePreferences({ attribute: "currency_code", value: [currency.toLowerCase()] }, { take: 1 })
    return prefs[0]?.is_tax_inclusive === true
  } catch {
    return false
  }
}

export async function defaultSalesChannelId(scope: Scope, configured: string): Promise<string | null> {
  if (configured) return configured
  try {
    const { data } = await queryOf(scope).graph({ entity: "store", fields: ["id", "default_sales_channel_id"], pagination: { take: 1, skip: 0 } })
    return ((data[0] as { default_sales_channel_id?: string | null } | undefined)?.default_sales_channel_id ?? null) || null
  } catch {
    return null
  }
}

export async function defaultShippingProfileId(scope: Scope, configured: string): Promise<string | null> {
  if (configured) return configured
  try {
    const fulfillment = (scope as { resolve<T>(k: string): T }).resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
    const [profile] = await fulfillment.listShippingProfiles({ type: "default" }, { take: 1 })
    if (profile) return profile.id
    const [any] = await fulfillment.listShippingProfiles({}, { take: 1 })
    return any?.id ?? null
  } catch {
    return null
  }
}
