/**
 * Options of `@koda-plus/medusa-plugin-coupons`. Everything is optional and
 * nothing here throws: broken values fall back to defaults and are listed in
 * `problems` for the admin.
 *
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-coupons", options: {
 *     currencyCode: "pln",
 *     memberGroupIds: ["cusgroup_b2b_verified", "cusgroup_b2b_premium"],
 *     codePrefix: "SHOP",
 *   } }]
 */
import type { PoolProductDto, StoreFeature, StoreTerms } from "./contract"

export interface CouponsPluginOptions {
  /** The currency of amount coupons and order minimums. Default "pln". */
  currencyCode?: string
  /**
   * Customer groups of logged-in members with their own prices (B2B,
   * wholesale). The creator warns when an automatic coupon would reach them
   * too. Default: none named, so the warning speaks of "logged-in groups".
   */
  memberGroupIds?: string[]
  /** A prefix for the codes the creator suggests ("SHOP" gives SHOP-AUTUMN15). Default none. */
  codePrefix?: string
  /**
   * The store's own rules of its promotions, for stores whose cart applies a
   * promotion with logic of its own (a free item for every seven, a price
   * list as the floor) while Medusa keeps only a marker of it (often a
   * 0.001% value, because Medusa takes no zero). Given the promotion ids,
   * answer a plain description per id; `replacesDiscount` says Medusa's
   * value is only that marker, so the sentence shows the store's rule in its
   * place. Never throws for the plugin: an error reads as no rules.
   */
  storeRules?: (scope: unknown, promotionIds: string[]) => Promise<Record<string, StoreRule>>
  /**
   * The store writes its own adjustments for some promotions, without a
   * promotion id (so Medusa cannot remove them on its own refresh), with a
   * description that starts with the code and a colon ("SHOP7: 1 free").
   * true counts those as the coupon's too, in its uses, discount and orders.
   * Default false.
   */
  codeInDescription?: boolean
  /**
   * The store's own terms of its coupons (pools of products, from N pieces,
   * a price list as the base, buy X get Y counted by the store, which codes
   * add up, orders per customer, a note for the customer). The creator and
   * the edit form show the features named here, the plugin reads and writes
   * them only through this adapter. Never throws for the plugin: a failed
   * read reads as no terms, a failed write is reported and nothing else of
   * the coupon is lost. Default none.
   */
  storeTerms?: StoreTermsAdapter
  /**
   * The value a store writes into a customer rule when nobody is left on it
   * (Medusa takes no empty rule). The sentence says "nobody" for it. Default none.
   */
  nobodyCustomerId?: string
  /**
   * Sends the coupon's code by e-mail with a short instruction, from the
   * coupon page ("Send the code"). The plugin sends no e-mails of its own:
   * without this option the button is hidden. The plugin hands over the
   * people who did not get the code before (never twice) and records who got
   * it in the promotion's metadata (code_sent). Give each e-mail an
   * idempotency key per coupon and customer (Medusa's notification module
   * takes idempotency_key). Answer the customer ids it went to.
   */
  sendCode?: (scope: unknown, input: CodeMailSend) => Promise<{ sent: string[]; failed?: Array<{ customerId: string; reason: string }> }>
  /** The same e-mail rendered for one person, sent to nobody (the preview before sending). Optional. */
  previewCode?: (scope: unknown, input: CodeMailPreview) => Promise<{ subject: string; html: string }>
}

/** The coupon an e-mail of its code is about. Dates are ISO strings, money in major units. */
export interface CodeMailCoupon {
  id: string
  code: string
  kind: string
  value: number | null
  currency: string | null
  startsAt: string | null
  endsAt: string | null
  /** The store's note for the customer (storeTerms), null without it. */
  note: string | null
}

export interface CodeMailRecipient {
  customerId: string
  email: string
  firstName: string | null
  /** Company or full name, as the panel names her. */
  name: string | null
}

export interface CodeMailSend {
  promotion: CodeMailCoupon
  recipients: CodeMailRecipient[]
  /** The instruction the admin read in the preview: the coupon's rules in a sentence or two. */
  message: string
  /** The admin who sends it (e-mail or user id). */
  sentBy: string | null
}

export interface CodeMailPreview {
  promotion: CodeMailCoupon
  recipient: CodeMailRecipient
  message: string
}

export interface StorePool {
  id: string
  name: string
  /** The target rule that limits the discount to this pool's products in Medusa (e.g. a product tag). */
  target?: { attribute: string; values: string[] } | null
}

export interface StoreTermsAdapter {
  features: StoreFeature[]
  /** What the store calls its pools, by language: { pl: "Grupy rabatowe", en: "Discount groups" }. */
  poolsLabel?: Record<string, string>
  lookups: (scope: unknown) => Promise<{ pools?: StorePool[]; priceLists?: Array<{ id: string; name: string }> }>
  read: (scope: unknown, promotionIds: string[]) => Promise<Record<string, StoreTerms>>
  /** Saves the terms of one promotion (null: the store forgets them). `kind` is the coupon's kind after the save. */
  write: (scope: unknown, promotionId: string, terms: StoreTerms | null, context: { code: string; kind: string }) => Promise<void>
  /**
   * The products (one row per variant) of a pool, for leaving single ones
   * out of a discount on pools. Optional: without it the plugin lists the
   * products the pool's target names (tags, categories, a collection,
   * products, a type). Give it when a pool holds variants rather than whole
   * products. A pool with products left out gets a target rule
   * items.variant_id "ne": a store that counts pieces itself ("from N
   * pieces") should leave those variants out of its count too.
   */
  poolProducts?: (scope: unknown, poolId: string) => Promise<PoolProductDto[]>
  /**
   * Buy X get Y counted by the store: Medusa keeps a standard promotion with
   * this percent on the items as a marker (Medusa takes no zero). Default 0.001.
   */
  buyGetMarker?: number
}

/** A promotion's rule as the store applies it, in one or two plain sentences. */
export interface StoreRule {
  text: string
  replacesDiscount?: boolean
}

export interface ResolvedCouponsOptions {
  currencyCode: string
  memberGroupIds: string[]
  codePrefix: string | null
  storeRules: CouponsPluginOptions["storeRules"] | null
  codeInDescription: boolean
  storeTerms: ResolvedStoreTerms | null
  nobodyCustomerId: string | null
  sendCode: CouponsPluginOptions["sendCode"] | null
  previewCode: CouponsPluginOptions["previewCode"] | null
  problems: string[]
}

export interface ResolvedStoreTerms extends StoreTermsAdapter {
  buyGetMarker: number
}

const FEATURES: readonly StoreFeature[] = ["note", "pools", "minQuantity", "priceLists", "buyGet", "combines", "perCustomerOrders", "threshold"]

export function resolveOptions(input: CouponsPluginOptions | undefined | null): ResolvedCouponsOptions {
  const o = (input && typeof input === "object" ? input : {}) as CouponsPluginOptions
  const problems: string[] = []
  const cur = typeof o.currencyCode === "string" ? o.currencyCode.trim().toLowerCase() : ""
  const currencyCode = /^[a-z]{3}$/.test(cur) ? cur : "pln"
  if (o.currencyCode !== undefined && currencyCode !== cur) problems.push('currencyCode (three letters, like "pln")')
  const memberGroupIds = Array.isArray(o.memberGroupIds)
    ? o.memberGroupIds.filter((g): g is string => typeof g === "string" && /^[A-Za-z0-9_]{1,80}$/.test(g))
    : []
  if (o.memberGroupIds !== undefined && (!Array.isArray(o.memberGroupIds) || memberGroupIds.length !== o.memberGroupIds.length)) {
    problems.push("memberGroupIds (a list of customer group ids)")
  }
  const prefixRaw = typeof o.codePrefix === "string" ? o.codePrefix.trim().toUpperCase() : ""
  const codePrefix = /^[A-Z0-9]{1,12}$/.test(prefixRaw) ? prefixRaw : null
  if (o.codePrefix !== undefined && !codePrefix) problems.push("codePrefix (letters and digits, at most 12)")
  const storeRules = typeof o.storeRules === "function" ? o.storeRules : null
  if (o.storeRules !== undefined && !storeRules) problems.push("storeRules (a function)")
  const codeInDescription = o.codeInDescription === true
  if (o.codeInDescription !== undefined && typeof o.codeInDescription !== "boolean") problems.push("codeInDescription (true or false)")

  let storeTerms: ResolvedStoreTerms | null = null
  const st = o.storeTerms as StoreTermsAdapter | undefined
  if (st !== undefined) {
    const ok = st && typeof st === "object" && typeof st.read === "function" && typeof st.write === "function" && typeof st.lookups === "function"
    if (!ok) problems.push("storeTerms (an object with lookups, read and write)")
    else {
      const features = (Array.isArray(st.features) ? st.features : []).filter((f): f is StoreFeature => FEATURES.includes(f))
      const marker = Number(st.buyGetMarker ?? 0.001)
      storeTerms = { ...st, features: [...new Set(features)], buyGetMarker: Number.isFinite(marker) && marker > 0 && marker < 1 ? marker : 0.001 }
    }
  }
  const nobodyCustomerId = typeof o.nobodyCustomerId === "string" && o.nobodyCustomerId.trim() ? o.nobodyCustomerId.trim() : null
  const sendCode = typeof o.sendCode === "function" ? o.sendCode : null
  if (o.sendCode !== undefined && !sendCode) problems.push("sendCode (a function)")
  const previewCode = typeof o.previewCode === "function" ? o.previewCode : null
  if (o.previewCode !== undefined && !previewCode) problems.push("previewCode (a function)")
  return { currencyCode, memberGroupIds, codePrefix, storeRules, codeInDescription, storeTerms, nobodyCustomerId, sendCode, previewCode, problems }
}
