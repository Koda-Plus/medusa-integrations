/**
 * THE MEDUSA SIDE OF THE FEED: every variant of the products in one sales
 * channel, with the calculated price of one region and the stock of the
 * channel's locations. Read through Query in passes of 200 products and 500
 * variants.
 *
 * ANY FAILED PASS FAILS THE BUILD. A file without prices or with guessed
 * stock is worse than the previous file, which stays served.
 *
 *   region         `feed.regionId`, or the oldest region in PLN
 *   sales channel  `feed.salesChannelId`, or the default channel of the store
 *   products       linked to that channel (`product_sales_channel`)
 *   price          `calculated_price` for the region in PLN
 *   stock          `product_variant_inventory_items` over the channel's
 *                  locations (`sales_channel_locations`)
 */

import { QueryContext } from "@medusajs/framework/utils"
import type { CatalogVariant } from "../../modules/ceneo/lib/feed"
import type { ResolvedCeneoOptions } from "../../modules/ceneo/lib/options"
import { brandOf } from "../../modules/ceneo/lib/brand"
import { availabilityByVariant, type InventoryLinkInput } from "../../modules/ceneo/lib/stock"
import { chunks, type QueryLike } from "./runtime"

export type CatalogErrorCode = "region_not_found" | "region_not_pln" | "no_pln_region" | "no_sales_channel" | "sales_channel_not_found"

/** A setup problem: the build fails with a code the admin can explain. */
export class CatalogError extends Error {
  readonly code: CatalogErrorCode
  constructor(code: CatalogErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

export interface FeedCatalog {
  regionId: string
  salesChannelId: string
  variants: CatalogVariant[]
  /** Parent of every Medusa category (hidden ones too): the mapping inherits along it. */
  categoryParents: Map<string, string | null>
}

interface ProductRecord {
  id: string
  handle?: string | null
  title?: string | null
  description?: string | null
  status?: string | null
  thumbnail?: string | null
  images?: Array<{ url?: string | null; rank?: number | null } | null> | null
  categories?: Array<{ id?: string | null } | null> | null
  metadata?: Record<string, unknown> | null
  type?: { value?: string | null } | null
  collection?: { title?: string | null } | null
  tags?: Array<{ value?: string | null } | null> | null
  variants?: Array<VariantRecord | null> | null
}

interface VariantRecord {
  id: string
  sku?: string | null
  title?: string | null
  ean?: string | null
  barcode?: string | null
  mid_code?: string | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
}

interface PriceRecord {
  id: string
  calculated_price?: { calculated_amount?: number | string | null; is_calculated_price_tax_inclusive?: boolean | null } | null
}

const PRODUCT_PAGE = 200
const VARIANT_PAGE = 500
const LINK_PAGE = 1000
const CEILING = 500_000

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

async function resolveRegion(query: QueryLike, o: ResolvedCeneoOptions): Promise<string> {
  if (o.feed.regionId) {
    const { data } = await query.graph({ entity: "region", fields: ["id", "currency_code"], filters: { id: o.feed.regionId } })
    const region = (data as Array<{ id: string; currency_code?: string | null }>)[0]
    if (!region) throw new CatalogError("region_not_found", `The region ${o.feed.regionId} (feed.regionId) does not exist.`)
    if (String(region.currency_code ?? "").toLowerCase() !== "pln") throw new CatalogError("region_not_pln", `The region ${region.id} is not in PLN; Ceneo shows prices in PLN.`)
    return region.id
  }
  const { data } = await query.graph({
    entity: "region",
    fields: ["id"],
    filters: { currency_code: "pln" },
    pagination: { take: 1, order: { created_at: "ASC" } },
  })
  const region = (data as Array<{ id: string }>)[0]
  if (!region) throw new CatalogError("no_pln_region", "No region in PLN: create one or set feed.regionId.")
  return region.id
}

async function resolveSalesChannel(query: QueryLike, o: ResolvedCeneoOptions): Promise<string> {
  if (o.feed.salesChannelId) {
    const { data } = await query.graph({ entity: "sales_channel", fields: ["id"], filters: { id: o.feed.salesChannelId } })
    if (data.length === 0) throw new CatalogError("sales_channel_not_found", `The sales channel ${o.feed.salesChannelId} (feed.salesChannelId) does not exist.`)
    return o.feed.salesChannelId
  }
  const { data } = await query.graph({ entity: "store", fields: ["id", "default_sales_channel_id"], pagination: { take: 1 } })
  const id = s((data as Array<{ default_sales_channel_id?: string | null }>)[0]?.default_sales_channel_id)
  if (!id) throw new CatalogError("no_sales_channel", "The store has no default sales channel: set feed.salesChannelId.")
  return id
}

async function productIdsInChannel(query: QueryLike, salesChannelId: string): Promise<string[]> {
  const ids: string[] = []
  for (let skip = 0; skip < CEILING; skip += LINK_PAGE) {
    const { data } = await query.graph({
      entity: "product_sales_channel",
      fields: ["product_id"],
      filters: { sales_channel_id: salesChannelId },
      /* A stable order, or OFFSET pages may skip products. */
      pagination: { skip, take: LINK_PAGE, order: { product_id: "ASC" } },
    })
    for (const row of data as Array<{ product_id?: string | null }>) {
      const id = s(row.product_id)
      if (id) ids.push(id)
    }
    if (data.length < LINK_PAGE) break
  }
  return [...new Set(ids)].sort()
}

/**
 * "Parent/Child" for every public category, from one read of the whole
 * tree. Internal or inactive categories (and their subtrees) never reach
 * Ceneo: their names are not meant for shoppers.
 */
async function categoryTree(query: QueryLike): Promise<{ paths: Map<string, string>; parents: Map<string, string | null> }> {
  const nodes = new Map<string, { name: string; parent: string | null; hidden: boolean }>()
  for (let skip = 0; skip < CEILING; skip += LINK_PAGE) {
    const { data } = await query.graph({
      entity: "product_category",
      fields: ["id", "name", "parent_category_id", "is_internal", "is_active"],
      pagination: { skip, take: LINK_PAGE, order: { id: "ASC" } },
    })
    for (const c of data as Array<{ id: string; name?: string | null; parent_category_id?: string | null; is_internal?: boolean | null; is_active?: boolean | null }>) {
      nodes.set(c.id, { name: s(c.name) ?? "", parent: s(c.parent_category_id), hidden: c.is_internal === true || c.is_active === false })
    }
    if (data.length < LINK_PAGE) break
  }
  const paths = new Map<string, string>()
  for (const id of nodes.keys()) {
    const parts: string[] = []
    const guard = new Set<string>()
    let hidden = false
    let cur: string | null = id
    while (cur && !guard.has(cur)) {
      guard.add(cur)
      const node = nodes.get(cur)
      if (!node) break
      if (node.hidden) hidden = true
      if (node.name) parts.unshift(node.name.replace(/\//g, " "))
      cur = node.parent
    }
    if (!hidden && parts.length > 0) paths.set(id, parts.join("/"))
  }
  const parents = new Map<string, string | null>([...nodes].map(([id, n]) => [id, n.parent]))
  return { paths, parents }
}


/** The most specific category of a product (the longest path, then the id). */
function pickCategory(categoryIds: string[], paths: Map<string, string>): string | null {
  let best: { path: string; depth: number; id: string } | null = null
  for (const id of categoryIds) {
    const path = paths.get(id)
    if (!path) continue
    const depth = path.split("/").length
    if (!best || depth > best.depth || (depth === best.depth && id < best.id)) best = { path, depth, id }
  }
  return best?.path ?? null
}

/** The stock locations of the channel. None linked: nothing counts, as in the store, where such a variant cannot be bought. */
async function channelLocations(query: QueryLike, salesChannelId: string): Promise<Set<string>> {
  const { data } = await query.graph({
    entity: "sales_channel_locations",
    fields: ["stock_location_id"],
    filters: { sales_channel_id: salesChannelId },
  })
  const ids = new Set((data as Array<{ stock_location_id?: string | null }>).map((l) => String(l.stock_location_id ?? "")).filter(Boolean))
  return ids
}

export async function loadFeedCatalog(query: QueryLike, o: ResolvedCeneoOptions): Promise<FeedCatalog> {
  const regionId = await resolveRegion(query, o)
  const salesChannelId = await resolveSalesChannel(query, o)
  const productIds = await productIdsInChannel(query, salesChannelId)
  const { paths, parents } = await categoryTree(query)
  const brandSource = o.feed.brand
  const brandFields = !brandSource ? [] : brandSource.from === "type" ? ["type.value"] : brandSource.from === "collection" ? ["collection.title"] : brandSource.from === "tag" ? ["tags.value"] : ["metadata"]

  const variants: CatalogVariant[] = []
  for (const part of chunks(productIds, PRODUCT_PAGE)) {
    const { data } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "handle",
        "title",
        "description",
        "status",
        "thumbnail",
        "images.url",
        "images.rank",
        "categories.id",
        ...brandFields,
        "variants.id",
        "variants.sku",
        "variants.title",
        "variants.ean",
        "variants.barcode",
        "variants.mid_code",
        "variants.manage_inventory",
        "variants.allow_backorder",
      ],
      filters: { id: part },
    })
    for (const p of data as ProductRecord[]) {
      const list = (p.variants ?? []).filter((v): v is VariantRecord => Boolean(v?.id))
      const gallery = (p.images ?? [])
        .filter((i): i is { url?: string | null; rank?: number | null } => Boolean(i))
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
        .map((i) => s(i.url))
        .filter((u): u is string => u !== null)
      const thumb = s(p.thumbnail)
      const images = thumb ? [thumb, ...gallery] : gallery
      const categoryIds = (p.categories ?? []).map((c) => s(c?.id)).filter((id): id is string => id !== null)
      const categoryPath = pickCategory(categoryIds, paths)
      const brand = brandOf(p, brandSource)
      for (const v of list) {
        variants.push({
          id: v.id,
          sku: s(v.sku),
          title: s(v.title),
          ean: s(v.ean),
          barcode: s(v.barcode),
          midCode: s(v.mid_code),
          manageInventory: v.manage_inventory !== false,
          allowBackorder: v.allow_backorder === true,
          productId: p.id,
          productHandle: s(p.handle),
          productTitle: s(p.title),
          productStatus: s(p.status),
          multiVariant: list.length > 1,
          description: typeof p.description === "string" ? p.description : null,
          images,
          categoryPath,
          categoryIds,
          ceneoCategory: null,
          brand,
          price: null,
          available: undefined,
        })
      }
    }
  }

  const byId = new Map(variants.map((v) => [v.id, v]))
  const ids = [...byId.keys()]

  for (const part of chunks(ids, VARIANT_PAGE)) {
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "calculated_price.calculated_amount", "calculated_price.is_calculated_price_tax_inclusive"],
      filters: { id: part },
      context: { calculated_price: QueryContext({ region_id: regionId, currency_code: "pln" }) },
    })
    for (const raw of data as PriceRecord[]) {
      const v = byId.get(raw.id)
      const cp = raw.calculated_price
      if (!v || !cp) continue
      const amount = typeof cp.calculated_amount === "number" ? cp.calculated_amount : Number(cp.calculated_amount)
      if (cp.calculated_amount !== null && cp.calculated_amount !== undefined && Number.isFinite(amount)) {
        v.price = { amount, taxInclusive: cp.is_calculated_price_tax_inclusive === true }
      }
    }
  }

  const locations = await channelLocations(query, salesChannelId)
  const links: InventoryLinkInput[] = []
  for (const part of chunks(ids, VARIANT_PAGE)) {
    const { data } = await query.graph({
      entity: "product_variant_inventory_items",
      fields: ["variant_id", "required_quantity", "inventory.id", "inventory.location_levels.location_id", "inventory.location_levels.available_quantity", "inventory.location_levels.stocked_quantity", "inventory.location_levels.reserved_quantity"],
      filters: { variant_id: part },
    })
    links.push(...(data as InventoryLinkInput[]))
  }
  const available = availabilityByVariant(links, locations)
  for (const v of variants) v.available = available.get(v.id)

  return { regionId, salesChannelId, variants, categoryParents: parents }
}
