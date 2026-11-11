/**
 * THE CPC TRANSPORT: what the bids and promotion code talks to. Pure, zero
 * runtime imports. The live one goes through `CeneoClient` (reads with
 * `fn`/`get`, writes with `fnWrite`/`write`, the barrier per writer); the
 * demo one simulates an account in the process: bids remembered per offer,
 * a made-up top 10 around the store's own price.
 */

import {
  functionError,
  promoRefused,
  readCategoryBids,
  readCategoryTop,
  readProductBids,
  readTopOffers,
  toPln,
  type BidRead,
  type CategoryTopProduct,
  type ProductOffers,
} from "./cpc"

export const DEMO_SHOP = "twoj-sklep.demo"

export interface CpcTransport {
  readonly demo: boolean
  productBids(keys: string[]): Promise<BidRead[]>
  categoryBid(categoryId: string): Promise<BidRead[]>
  topOffers(keys: string[]): Promise<ProductOffers[]>
  categoryTop(categoryName: string, top: number): Promise<CategoryTopProduct[]>
  /** Bids by Ceneo product id, in grosze. */
  setProductBids(bids: Array<{ ceneoProductId: string; bid: number }>): Promise<void>
  setCategoryBids(bids: Array<{ categoryId: string; bid: number }>): Promise<void>
  /** Returns the ids Ceneo did not take. */
  setPromo(kind: "product" | "category", keys: string[], text: string | null): Promise<string[]>
}

export interface CpcClient {
  fn(path: string, params: Record<string, string>): Promise<unknown>
  fnWrite(path: string, params: Record<string, string>, writer: string): Promise<unknown>
  get(path: string, query?: Record<string, string>): Promise<unknown>
  write(path: string, query: Record<string, string>, writer: string): Promise<unknown>
}

export const CPC_PATHS = {
  productBids: "/api/v2/function/bidding.GetProductsBidsByShopProductId/Call",
  categoryBid: "/api/v2/function/bidding.GetCategoryBidByCategoryId/Call",
  topOffers: "/api/v2/function/webapi_data_critical.shop_getProductTop10OffersBy_IDs/Call",
  categoryTop: "/api/v3/GetTopCategoryProducts",
  setProductBids: "/api/v2/function/bidding.SetProductsBids/Call",
  setCategoryBids: "/api/v2/function/bidding.SetCategoryBids/Call",
  setPromoProducts: "/api/v3/SetPromotionTextForProducts",
  setPromoCategories: "/api/v3/SetPromotionTextForCategories",
  removePromoProducts: "/api/v3/RemovePromotionTextsForProducts",
  removePromoCategories: "/api/v3/RemovePromotionTextsForCategories",
} as const

/** Ceneo answered, and refused (a wrong id, a bid out of range): the request was understood. */
export class FunctionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CeneoFunctionError"
  }
}

function checked(body: unknown): unknown {
  const err = functionError(body)
  if (err) throw new FunctionError(err)
  return body
}

/** The bids as the Swagger example writes them: `[{"CeneoProductId":1,"MaxBid":0.25}]`. */
export function bidsParam(bids: ReadonlyArray<{ id: string; bid: number }>, idKey: "CeneoProductId" | "CategoryId"): string {
  return JSON.stringify(bids.map((b) => ({ [idKey]: /^\d+$/.test(b.id) ? Number(b.id) : b.id, MaxBid: toPln(b.bid) })))
}

export function liveCpcTransport(client: CpcClient): CpcTransport {
  return {
    demo: false,
    async productBids(keys) {
      if (keys.length === 0) return []
      return readProductBids(checked(await client.fn(CPC_PATHS.productBids, { products: JSON.stringify(keys.map((k) => ({ ShopProductId: k }))) })))
    },
    async categoryBid(categoryId) {
      return readCategoryBids(checked(await client.fn(CPC_PATHS.categoryBid, { categoryId })))
    },
    async topOffers(keys) {
      if (keys.length === 0) return []
      return readTopOffers(checked(await client.fn(CPC_PATHS.topOffers, { shop_product_ids_comma_separated: keys.join(",") })))
    },
    async categoryTop(categoryName, top) {
      return readCategoryTop(await client.get(CPC_PATHS.categoryTop, { categoryName, top: String(Math.max(1, Math.min(100, top))) }))
    },
    async setProductBids(bids) {
      if (bids.length === 0) return
      checked(await client.fnWrite(CPC_PATHS.setProductBids, { bids: bidsParam(bids.map((b) => ({ id: b.ceneoProductId, bid: b.bid })), "CeneoProductId") }, "bids"))
    },
    async setCategoryBids(bids) {
      if (bids.length === 0) return
      checked(await client.fnWrite(CPC_PATHS.setCategoryBids, { bids: bidsParam(bids.map((b) => ({ id: b.categoryId, bid: b.bid })), "CategoryId") }, "bids"))
    },
    async setPromo(kind, keys, text) {
      if (keys.length === 0) return []
      const ids = keys.join(",")
      if (kind === "product") {
        const body = text === null ? await client.write(CPC_PATHS.removePromoProducts, { shopProductIds: ids }, "promo") : await client.write(CPC_PATHS.setPromoProducts, { shopProductIds: ids, promotionText: text }, "promo")
        return promoRefused(body, "ShopProductId", text === null ? "IsDeleted" : "IsSet")
      }
      const body = text === null ? await client.write(CPC_PATHS.removePromoCategories, { categoryIds: ids }, "promo") : await client.write(CPC_PATHS.setPromoCategories, { categoryIds: ids, promotionText: text }, "promo")
      return promoRefused(body, "CategoryId", text === null ? "IsDeleted" : "IsSet")
    },
  }
}

/* ---- the simulated account ---------------------------------------------- */

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

type DemoState = { bids: Map<string, number>; categoryBids: Map<string, number>; promo: Map<string, string> }
const STATE = Symbol.for("koda.ceneo.demo.cpc")

function demoState(): DemoState {
  const h = globalThis as typeof globalThis & { [STATE]?: DemoState }
  if (!h[STATE]) h[STATE] = { bids: new Map(), categoryBids: new Map(), promo: new Map() }
  return h[STATE]
}

/** Clears the simulated bids (tests). */
export function resetDemoCpc(): void {
  const s = demoState()
  s.bids.clear()
  s.categoryBids.clear()
  s.promo.clear()
}

/** A Ceneo product id for a demo offer: stable, 8 digits. */
export const demoCeneoId = (key: string) => String(10_000_000 + (hash(`cid:${key}`) % 89_999_999))

export function demoCpcTransport(prices: ReadonlyMap<string, number>): CpcTransport {
  const s = demoState()
  const byCeneo = new Map([...prices.keys()].map((k) => [demoCeneoId(k), k]))
  return {
    demo: true,
    async productBids(keys) {
      return keys
        .filter((k) => prices.has(k))
        .map((k) => {
          const bid = s.bids.get(k) ?? (hash(`bid:${k}`) % 3 === 0 ? 0 : 10 + (hash(`bid:${k}`) % 30))
          return { key: k, ceneoProductId: demoCeneoId(k), name: null, bid, clickRate: 18, clickRateWithMaxBid: 18 + bid }
        })
    },
    async categoryBid(categoryId) {
      return [{ key: categoryId, ceneoProductId: null, name: null, bid: s.categoryBids.get(categoryId) ?? 0, clickRate: null, clickRateWithMaxBid: null }]
    },
    async topOffers(keys) {
      return keys
        .filter((k) => prices.has(k))
        .map((k) => {
          const price = prices.get(k) ?? 0
          const n = 3 + (hash(`n:${k}`) % 8)
          const mine = 1 + (hash(`pos:${k}`) % n)
          const offers = Array.from({ length: n }, (_, i) => {
            const pos = i + 1
            const own = pos === mine
            const delta = ((hash(`${k}:${pos}`) % 21) - 10) / 100
            return { shop: own ? DEMO_SHOP : `sklep-${(hash(`${k}:s${pos}`) % 90) + 10}.demo`, price: Math.round(price * (1 + (own ? 0 : delta)) * 100) / 100, position: pos, stock: hash(`${k}:st${pos}`) % 20, reviews: hash(`${k}:r${pos}`) % 3000, suggested: pos === 1, deliveryCost: pos % 2 === 0 ? 0 : 9.99 }
          })
          return { key: k, ceneoProductId: demoCeneoId(k), offersNumber: n, minSuggestedBid: 5 + (hash(`min:${k}`) % 20), offers }
        })
    },
    async categoryTop(categoryName, top) {
      const keys = [...prices.keys()].sort().slice(0, Math.max(1, Math.min(100, top)))
      return keys.map((k, i) => ({ ceneoProductId: Number(demoCeneoId(k)), name: `${categoryName} (demo) ${i + 1}`, category: categoryName, lowestPrice: prices.get(k) ?? null, bidded: i % 2 === 0, biddedByMe: s.bids.has(k), soldByMe: true, myProductId: k, myPrice: prices.get(k) ?? null }))
    },
    async setProductBids(bids) {
      for (const b of bids) {
        const key = byCeneo.get(b.ceneoProductId)
        if (key) s.bids.set(key, b.bid)
      }
    },
    async setCategoryBids(bids) {
      for (const b of bids) s.categoryBids.set(b.categoryId, b.bid)
    },
    async setPromo(kind, keys, text) {
      for (const k of keys) {
        const id = `${kind}:${k}`
        if (text === null) s.promo.delete(id)
        else s.promo.set(id, text)
      }
      return []
    },
  }
}
