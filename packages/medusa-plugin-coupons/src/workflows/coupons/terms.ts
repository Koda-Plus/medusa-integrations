/**
 * THE STORE'S OWN TERMS through the store's adapter (option storeTerms):
 * read for the list and the forms, written next to a promotion. A failed
 * read is no terms; a failed write is a CouponInputError the route answers.
 */
import type { StoreLookups, StoreTerms } from "../../modules/coupons/lib/contract"
import type { ResolvedStoreTerms, StorePool } from "../../modules/coupons/lib/options"
import { CouponInputError } from "./errors"
import { couponsService, type Scope } from "./runtime"

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
