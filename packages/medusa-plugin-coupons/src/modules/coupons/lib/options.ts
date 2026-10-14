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
}

export interface ResolvedCouponsOptions {
  currencyCode: string
  memberGroupIds: string[]
  codePrefix: string | null
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
  return { currencyCode, memberGroupIds, codePrefix, problems }
}
