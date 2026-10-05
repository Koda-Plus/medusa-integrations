/**
 * THE MEDUSA SIDE OF A PLAN: every variant with its product status, base
 * price in the market currency, categories, metadata and stock. Read through
 * Query in three passes (variants, prices, inventory), 500 variants at a
 * time, so a failure of one pass is reported instead of guessed:
 *
 *   variants fail    nothing is planned (complete = false)
 *   prices fail      no price plan (pricesComplete = false)
 *   inventory fails  no alerts and no lifecycle plan (stockComplete = false)
 */

import { MARKET_CURRENCY, type OlxMarket } from "../../modules/olx/lib/constants"
import type { ResolvedOlxOptions } from "../../modules/olx/lib/options"
import { basePrice, type PriceRecord } from "../../modules/olx/lib/pricing"
import { availabilityByVariant, stockState, type InventoryLinkInput, type StockState } from "../../modules/olx/lib/stock"
import { chunks, type QueryLike } from "./runtime"

export interface PlanVariant {
  id: string
  sku: string | null
  title: string | null
  productId: string
  productTitle: string | null
  productStatus: string | null
  manageInventory: boolean
  allowBackorder: boolean
  price: number | null
  categoryIds: string[]
  categoryHandles: string[]
  metadata: Record<string, unknown> | null
  productMetadata: Record<string, unknown> | null
  stock: StockState
}

export interface PlanCatalog {
  variants: Map<string, PlanVariant>
  /** Product ids with more than one variant (their adverts name the variant). */
  multiVariant: Set<string>
  complete: boolean
  pricesComplete: boolean
  stockComplete: boolean
  message: string | null
}

interface VariantRecord {
  id: string
  sku?: string | null
  title?: string | null
  product_id?: string | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  metadata?: Record<string, unknown> | null
  product?: {
    title?: string | null
    status?: string | null
    metadata?: Record<string, unknown> | null
    categories?: Array<{ id?: string | null; handle?: string | null } | null> | null
  } | null
  prices?: PriceRecord[] | null
}

const PAGE = 500
const CEILING = 200_000

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function marketCurrency(market: OlxMarket): string {
  return MARKET_CURRENCY[market] ?? "eur"
}

export async function loadPlanCatalog(query: QueryLike, o: ResolvedOlxOptions): Promise<PlanCatalog> {
  const variants = new Map<string, PlanVariant>()
  const perProduct = new Map<string, number>()
  const out: PlanCatalog = {
    variants,
    multiVariant: new Set(),
    complete: false,
    pricesComplete: false,
    stockComplete: false,
    message: null,
  }

  try {
    for (let skip = 0; skip < CEILING; skip += PAGE) {
      const { data } = await query.graph({
        entity: "product_variant",
        fields: [
          "id",
          "sku",
          "title",
          "product_id",
          "manage_inventory",
          "allow_backorder",
          "metadata",
          "product.title",
          "product.status",
          "product.metadata",
          "product.categories.id",
          "product.categories.handle",
        ],
        pagination: { skip, take: PAGE, order: { id: "ASC" } },
      })
      for (const raw of data as VariantRecord[]) {
        if (!raw?.id || !raw.product_id) continue
        const cats = (raw.product?.categories ?? []).filter(Boolean) as Array<{ id?: string | null; handle?: string | null }>
        variants.set(raw.id, {
          id: raw.id,
          sku: String(raw.sku ?? "").trim() || null,
          title: raw.title ?? null,
          productId: raw.product_id,
          productTitle: raw.product?.title ?? null,
          productStatus: raw.product?.status ?? null,
          manageInventory: raw.manage_inventory !== false,
          allowBackorder: raw.allow_backorder === true,
          price: null,
          categoryIds: cats.map((c) => String(c.id ?? "")).filter(Boolean),
          categoryHandles: cats.map((c) => String(c.handle ?? "")).filter(Boolean),
          metadata: obj(raw.metadata),
          productMetadata: obj(raw.product?.metadata),
          stock: { kind: "unknown" },
        })
        perProduct.set(raw.product_id, (perProduct.get(raw.product_id) ?? 0) + 1)
      }
      if (data.length < PAGE) break
    }
    out.complete = true
  } catch (err) {
    out.message = `Reading the catalog failed: ${err instanceof Error ? err.message : String(err)}`
    return out
  }
  for (const [productId, n] of perProduct) if (n > 1) out.multiVariant.add(productId)

  const ids = [...variants.keys()]
  const currency = marketCurrency(o.market)

  try {
    for (const part of chunks(ids, PAGE)) {
      const { data } = await query.graph({
        entity: "product_variant",
        fields: ["id", "prices.amount", "prices.currency_code", "prices.rules_count", "prices.price_list_id", "prices.min_quantity"],
        filters: { id: part },
      })
      for (const raw of data as VariantRecord[]) {
        const v = variants.get(raw.id)
        if (v) v.price = basePrice(raw.prices ?? [], currency)
      }
    }
    out.pricesComplete = true
  } catch (err) {
    out.message = `Reading prices failed: ${err instanceof Error ? err.message : String(err)}`
  }

  try {
    let locations: Set<string> | null = null
    if (o.salesChannelId) {
      const { data } = await query.graph({
        entity: "sales_channel_locations",
        fields: ["stock_location_id"],
        filters: { sales_channel_id: o.salesChannelId },
      })
      locations = new Set((data as Array<{ stock_location_id?: string | null }>).map((l) => String(l.stock_location_id ?? "")).filter(Boolean))
    }
    const links: InventoryLinkInput[] = []
    for (const part of chunks(ids, PAGE)) {
      const { data } = await query.graph({
        entity: "product_variant_inventory_items",
        fields: ["variant_id", "required_quantity", "inventory.id", "inventory.location_levels.*"],
        filters: { variant_id: part },
      })
      links.push(...(data as InventoryLinkInput[]))
    }
    const available = availabilityByVariant(links, locations)
    for (const v of variants.values()) {
      v.stock = stockState({ manageInventory: v.manageInventory, allowBackorder: v.allowBackorder }, available.get(v.id))
    }
    out.stockComplete = true
  } catch (err) {
    out.message = `Reading stock failed: ${err instanceof Error ? err.message : String(err)}`
  }
  return out
}

export interface CandidateDetails {
  description: string | null
  images: string[]
}

/** Description and images of a few products, for the publish plan. */
export async function loadCandidateDetails(query: QueryLike, productIds: string[]): Promise<Map<string, CandidateDetails>> {
  const out = new Map<string, CandidateDetails>()
  for (const part of chunks([...new Set(productIds)], 100)) {
    const { data } = await query.graph({
      entity: "product",
      fields: ["id", "description", "thumbnail", "images.url"],
      filters: { id: part },
    })
    for (const raw of data as Array<{ id: string; description?: string | null; thumbnail?: string | null; images?: Array<{ url?: string | null } | null> | null }>) {
      const images = [raw.thumbnail ?? "", ...(raw.images ?? []).map((i) => i?.url ?? "")].map((u) => u.trim()).filter(Boolean)
      out.set(raw.id, { description: raw.description ?? null, images: [...new Set(images)] })
    }
  }
  return out
}
