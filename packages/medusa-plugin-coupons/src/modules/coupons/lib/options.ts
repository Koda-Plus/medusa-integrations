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
  problems: string[]
}

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
  return { currencyCode, memberGroupIds, codePrefix, storeRules, problems }
}
