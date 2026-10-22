/**
 * THE STORE'S OWN TERMS through the store's adapter (option storeTerms):
 * read for the list and the forms, written next to a promotion. A failed
 * read is no terms; a failed write is a CouponInputError the route answers.
 */
import type { PoolProductDto, PoolProductsResponse, StoreLookups, StoreTerms } from "../../modules/coupons/lib/contract"
import type { ResolvedStoreTerms, StorePool } from "../../modules/coupons/lib/options"
import { CouponInputError } from "./errors"
import { couponsService, queryOf, type Scope } from "./runtime"

export function storeAdapter(scope: Scope): ResolvedStoreTerms | null {
  return couponsService(scope).getOptions().storeTerms
}

export async function readTerms(scope: Scope, promotionIds: string[]): Promise<Record<string, StoreTerms>> {
  const adapter = storeAdapter(scope)
  const ids = [...new Set(promotionIds.filter(Boolean))]
  if (!adapter || !ids.length) return {}
  try {
    return (await adapter.read(scope, ids)) ?? {}
  } catch (err) {
    couponsService(scope).getLogger().warn(`[coupons] The store's terms could not be read: ${(err as Error)?.message ?? err}`)
    return {}
  }
}

export async function writeTerms(scope: Scope, promotionId: string, terms: StoreTerms | null, context: { code: string; kind: string }): Promise<void> {
  const adapter = storeAdapter(scope)
  if (!adapter) return
  try {
    await adapter.write(scope, promotionId, terms, context)
  } catch (err) {
    couponsService(scope).getLogger().error(`[coupons] The store's terms of ${context.code} (${promotionId}) were not saved: ${(err as Error)?.message ?? err}`)
    throw new CouponInputError(500, ["terms_not_saved"], "The store's terms of the coupon were not saved.")
  }
}

/** The pools and price lists of the store, with the target rules of the pools (server side only). */
export async function storeLookups(scope: Scope): Promise<{ lookups: StoreLookups | null; pools: StorePool[] }> {
  const adapter = storeAdapter(scope)
  if (!adapter) return { lookups: null, pools: [] }
  let pools: StorePool[] = []
  let priceLists: Array<{ id: string; name: string }> = []
  try {
    const r = await adapter.lookups(scope)
    pools = (r?.pools ?? []).filter((p) => p && typeof p.id === "string" && p.id)
    priceLists = (r?.priceLists ?? []).filter((p) => p && typeof p.id === "string" && p.id)
  } catch (err) {
    couponsService(scope).getLogger().warn(`[coupons] The store's lists could not be read: ${(err as Error)?.message ?? err}`)
  }
  return {
    lookups: {
      features: adapter.features,
      poolsLabel: adapter.poolsLabel ?? null,
      pools: pools.map((p) => ({ id: p.id, name: p.name || p.id })),
      priceLists: priceLists.map((p) => ({ id: p.id, name: p.name || p.id })),
    },
    pools,
  }
}

/** The attributes the pools' targets use (e.g. product tags), for removing the old pool targets. */
export function poolAttributes(pools: readonly StorePool[]): string[] {
  return [...new Set(pools.map((p) => p.target?.attribute).filter((a): a is string => Boolean(a)))]
}

/** At most this many products of one pool on the list (the creator searches among them). */
export const POOL_PRODUCTS_LIMIT = 500

/** The product filter of a pool's target, null when the plugin cannot list it. */
export function productFilterOf(target: StorePool["target"]): Record<string, unknown> | null {
  const values = (target?.values ?? []).map(String).filter(Boolean)
  if (!target?.attribute || !values.length) return null
  switch (target.attribute) {
    case "items.product.tags.id":
      return { tags: { id: values } }
    case "items.product.categories.id":
      return { categories: { id: values } }
    case "items.product.collection_id":
      return { collection_id: values }
    case "items.product.type_id":
      return { type_id: values }
    case "items.product.id":
      return { id: values }
    default:
      return null
  }
}

type ProductRow = { id?: string; title?: string | null; thumbnail?: string | null; variants?: Array<{ id?: string; title?: string | null; sku?: string | null }> | null }

/** Products of Query as one row per variant, sorted by title; a lone default variant has no title of its own. */
export function poolRowsOf(products: readonly ProductRow[]): PoolProductDto[] {
  const out: PoolProductDto[] = []
  for (const p of products) {
    const variants = (p.variants ?? []).filter((v) => v?.id)
    for (const v of variants) {
      const own = v.title && v.title !== p.title && !(variants.length === 1 && /^default/i.test(v.title)) ? v.title : null
      out.push({ variantId: String(v.id), productId: String(p.id ?? ""), title: p.title ?? String(p.id ?? ""), variantTitle: own, sku: v.sku ?? null, thumbnail: p.thumbnail ?? null })
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title) || (a.variantTitle ?? "").localeCompare(b.variantTitle ?? ""))
}

/**
 * The products of one of the store's pools, one row per variant: from the
 * store's adapter when it lists them itself, else the products its target
 * names. Never throws: a failure reads as an empty, unsupported list.
 */
export async function poolProducts(scope: Scope, poolId: string): Promise<PoolProductsResponse> {
  const adapter = storeAdapter(scope)
  const empty = (supported: boolean): PoolProductsResponse => ({ pool: poolId, products: [], supported })
  if (!adapter) return empty(false)
  try {
    if (typeof adapter.poolProducts === "function") {
      const rows = (await adapter.poolProducts(scope, poolId)) ?? []
      return { pool: poolId, products: rows.filter((r) => r && typeof r.variantId === "string" && r.variantId).slice(0, POOL_PRODUCTS_LIMIT), supported: true }
    }
    const { pools } = await storeLookups(scope)
    const filter = productFilterOf(pools.find((p) => p.id === poolId)?.target ?? null)
    if (!filter) return empty(false)
    const { data } = await queryOf(scope).graph({
      entity: "product",
      fields: ["id", "title", "thumbnail", "variants.id", "variants.title", "variants.sku"],
      filters: filter,
      pagination: { take: POOL_PRODUCTS_LIMIT, skip: 0 },
    })
    return { pool: poolId, products: poolRowsOf((data ?? []) as ProductRow[]).slice(0, POOL_PRODUCTS_LIMIT), supported: true }
  } catch (err) {
    couponsService(scope).getLogger().warn(`[coupons] The products of the pool ${poolId} could not be read: ${(err as Error)?.message ?? err}`)
    return empty(false)
  }
}
