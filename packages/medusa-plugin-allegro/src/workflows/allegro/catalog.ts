/**
 * THE MEDUSA SIDE: variants with a SKU, their available quantity, their
 * prices and price bounds, their EAN and inventory, and the stock locations
 * of a sales channel. Read through Query.
 */

import type { CatalogVariant } from "../../modules/allegro/lib/matching"
import { boundValue, type PriceBounds } from "../../modules/allegro/lib/price-plan"
import type { VariantInventory } from "../../modules/allegro/lib/reservations"
import { availableFor, type VariantStockRecord } from "../../modules/allegro/lib/stock"

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export interface StockedVariant extends CatalogVariant {
  /** Items Medusa can sell now in the chosen locations, null when not tracked. */
  available: number | null
}

interface LevelRecord {
  location_id?: string | null
  stocked_quantity?: number | string | null
  reserved_quantity?: number | string | null
}

interface VariantRecord {
  id: string
  sku?: string | null
  title?: string | null
  ean?: string | null
  barcode?: string | null
  product_id?: string | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  metadata?: Record<string, unknown> | null
  product?: { title?: string | null; metadata?: Record<string, unknown> | null } | null
  inventory_items?: Array<{
    inventory_item_id?: string | null
    required_quantity?: number | string | null
    inventory?: { id?: string | null; location_levels?: LevelRecord[] | null } | null
  } | null> | null
}

function stockRecord(raw: VariantRecord): VariantStockRecord {
  return {
    id: raw.id,
    manageInventory: raw.manage_inventory !== false,
    items: (raw.inventory_items ?? [])
      .filter((i): i is NonNullable<typeof i> => Boolean(i))
      .map((i) => ({
        requiredQuantity: Number(i.required_quantity ?? 1) || 1,
        levels: (i.inventory?.location_levels ?? []).map((l) => ({
          locationId: String(l.location_id ?? ""),
          stocked: Number(l.stocked_quantity ?? 0) || 0,
          reserved: Number(l.reserved_quantity ?? 0) || 0,
        })),
      })),
  }
}

/** Every variant with a SKU and its available quantity. Throws when a page fails: the caller treats that as an incomplete read. */
export async function loadCatalog(query: QueryLike, locationIds: readonly string[]): Promise<StockedVariant[]> {
  const out: StockedVariant[] = []
  const take = 500
  for (let skip = 0; skip < 500_000; skip += take) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: [
        "id",
        "sku",
        "product_id",
        "manage_inventory",
        "product.title",
        "inventory_items.required_quantity",
        "inventory_items.inventory.location_levels.location_id",
        "inventory_items.inventory.location_levels.stocked_quantity",
        "inventory_items.inventory.location_levels.reserved_quantity",
      ],
      pagination: { skip, take, order: { id: "ASC" } },
    })
    for (const raw of data as VariantRecord[]) {
      const sku = String(raw.sku ?? "").trim()
      if (!sku || !raw.product_id) continue
      out.push({
        id: raw.id,
        sku,
        productId: raw.product_id,
        productTitle: raw.product?.title ?? null,
        available: availableFor(stockRecord(raw), locationIds.length > 0 ? locationIds : null),
      })
    }
    if (data.length < take) break
  }
  return out
}

/** Prices of the few variants used by the demo, in PLN when the store has it. Optional. */
export async function demoPrices(query: QueryLike, ids: string[]): Promise<Map<string, { value: number; currency: string }>> {
  const out = new Map<string, { value: number; currency: string }>()
  if (ids.length === 0) return out
  try {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "prices.amount", "prices.currency_code"],
      filters: { id: ids },
    })
    for (const raw of data as Array<{ id: string; prices?: Array<{ amount?: number | string | null; currency_code?: string | null }> | null }>) {
      const prices = (raw.prices ?? []).filter((p) => p && p.amount != null && p.currency_code)
      const pick = prices.find((p) => String(p.currency_code).toLowerCase() === "pln") ?? prices[0]
      if (!pick) continue
      const value = Number(pick.amount)
      if (Number.isFinite(value)) out.set(raw.id, { value, currency: String(pick.currency_code).toUpperCase() })
    }
  } catch {
    /* Prices are decoration in demo mode. */
  }
  return out
}

/** Stock locations that exist, to catch a mistyped `stockLocationIds` before it reads as zero stock. */
export async function unknownLocations(query: QueryLike, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const { data } = await query.graph({ entity: "stock_location", fields: ["id"], filters: { id: [...ids] } })
  const found = new Set((data as Array<{ id: string }>).map((l) => l.id))
  return ids.filter((id) => !found.has(id))
}

/** How many stock locations the store has at all. */
export async function locationCount(query: QueryLike): Promise<number> {
  const { data } = await query.graph({ entity: "stock_location", fields: ["id"], pagination: { take: 50 } })
  return data.length
}

interface PriceRecord {
  amount?: number | string | null
  currency_code?: string | null
  price_list_id?: string | null
  min_quantity?: number | string | null
  max_quantity?: number | string | null
  rules_count?: number | string | null
}

/**
 * Medusa prices per variant and currency: the default price (no price list,
 * no rules, no quantity tier), or the price of the given price list.
 */
export async function loadVariantPrices(query: QueryLike, ids: readonly string[], priceListId: string | null): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "prices.amount", "prices.currency_code", "prices.price_list_id", "prices.min_quantity", "prices.max_quantity", "prices.rules_count"],
      filters: { id: [...chunk] },
    })
    for (const raw of data as Array<{ id: string; prices?: PriceRecord[] | null }>) {
      const byCurrency = new Map<string, number>()
      for (const p of raw.prices ?? []) {
        if (!p || p.amount === null || p.amount === undefined || !p.currency_code) continue
        const list = p.price_list_id ?? null
        if (priceListId ? list !== priceListId : list !== null) continue
        if (!priceListId && (Number(p.rules_count ?? 0) > 0 || (p.min_quantity !== null && p.min_quantity !== undefined && Number(p.min_quantity) > 1))) continue
        const value = Number(p.amount)
        if (!Number.isFinite(value)) continue
        const currency = String(p.currency_code).toUpperCase()
        if (!byCurrency.has(currency)) byCurrency.set(currency, value)
      }
      out.set(raw.id, byCurrency)
    }
  }
  return out
}

/** Why a price or draft plan is refused when the store keeps PLN prices without tax. */
export const TAX_EXCLUSIVE_PRICES = "tax_exclusive_prices"
export const TAX_EXCLUSIVE_MESSAGE =
  "Medusa keeps PLN prices without tax and Allegro takes gross prices, so nothing is planned. Make the PLN price preference tax inclusive in Medusa, or set prices.taxInclusive: true if your PLN prices already include tax."

/**
 * Whether the Medusa prices the plugin sends are gross. Allegro takes gross
 * prices; Medusa keeps net prices unless a price preference says otherwise,
 * and a net price sent as it is sells on Allegro without the VAT. The option
 * `prices.taxInclusive` wins; otherwise the PLN price preference decides (no
 * preference: net, Medusa's default).
 */
export async function plnPricesIncludeTax(query: QueryLike, option: boolean | null): Promise<boolean> {
  if (option !== null) return option
  const { data } = await query.graph({
    entity: "price_preference",
    fields: ["id", "attribute", "value", "is_tax_inclusive"],
    filters: { attribute: "currency_code", value: "pln" },
  })
  return (data as Array<{ is_tax_inclusive?: boolean | null }>).some((p) => p.is_tax_inclusive === true)
}

/** Price bounds from variant metadata, then product metadata. */
export async function loadVariantBounds(query: QueryLike, ids: readonly string[], minKey: string, maxKey: string): Promise<Map<string, PriceBounds>> {
  const out = new Map<string, PriceBounds>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data } = await query.graph({ entity: "product_variant", fields: ["id", "metadata", "product.metadata"], filters: { id: [...chunk] } })
    for (const raw of data as VariantRecord[]) {
      const v = raw.metadata ?? {}
      const p = raw.product?.metadata ?? {}
      out.set(raw.id, { min: boundValue(v[minKey]) ?? boundValue(p[minKey]), max: boundValue(v[maxKey]) ?? boundValue(p[maxKey]) })
    }
  }
  return out
}

export interface PublishCandidate {
  id: string
  sku: string
  productId: string
  title: string
  ean: string | null
}

/** Variants with a SKU, with their EAN (or barcode) and title, for publish by EAN. */
export async function loadPublishCandidates(query: QueryLike): Promise<PublishCandidate[]> {
  const out: PublishCandidate[] = []
  const take = 500
  for (let skip = 0; skip < 200_000; skip += take) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "sku", "ean", "barcode", "title", "product_id", "product.title"],
      pagination: { skip, take, order: { id: "ASC" } },
    })
    for (const raw of data as VariantRecord[]) {
      const sku = String(raw.sku ?? "").trim()
      if (!sku || !raw.product_id) continue
      const title = [raw.product?.title, raw.title && raw.title !== "Default variant" ? raw.title : null].filter(Boolean).join(" ")
      out.push({ id: raw.id, sku, productId: raw.product_id, title: title || sku, ean: (raw.ean || raw.barcode || null) as string | null })
    }
    if (data.length < take) break
  }
  return out
}

/** Inventory of the given variants, for reservations. */
export async function loadVariantInventory(query: QueryLike, ids: readonly string[]): Promise<Map<string, VariantInventory>> {
  const out = new Map<string, VariantInventory>()
  if (ids.length === 0) return out
  const { data } = await query.graph({
    entity: "product_variant",
    fields: [
      "id",
      "sku",
      "manage_inventory",
      "allow_backorder",
      "inventory_items.inventory_item_id",
      "inventory_items.required_quantity",
      "inventory_items.inventory.location_levels.location_id",
      "inventory_items.inventory.location_levels.stocked_quantity",
      "inventory_items.inventory.location_levels.reserved_quantity",
    ],
    filters: { id: [...ids] },
  })
  for (const raw of data as VariantRecord[]) {
    out.set(raw.id, {
      variantId: raw.id,
      sku: raw.sku ?? null,
      manageInventory: raw.manage_inventory !== false,
      allowBackorder: raw.allow_backorder === true,
      items: (raw.inventory_items ?? [])
        .filter((i): i is NonNullable<typeof i> => Boolean(i?.inventory_item_id))
        .map((i) => ({
          inventoryItemId: String(i.inventory_item_id),
          requiredQuantity: Number(i.required_quantity ?? 1) || 1,
          levels: (i.inventory?.location_levels ?? []).map((l) => ({
            locationId: String(l.location_id ?? ""),
            stocked: Number(l.stocked_quantity ?? 0) || 0,
            reserved: Number(l.reserved_quantity ?? 0) || 0,
          })),
        })),
    })
  }
  return out
}

/** Stock locations linked to a sales channel. */
export async function channelLocationIds(query: QueryLike, salesChannelId: string): Promise<string[]> {
  const { data } = await query.graph({ entity: "sales_channel", fields: ["id", "stock_locations.id"], filters: { id: salesChannelId } })
  const channel = (data as Array<{ stock_locations?: Array<{ id?: string | null } | null> | null }>)[0]
  return (channel?.stock_locations ?? []).map((l) => String(l?.id ?? "")).filter(Boolean)
}
