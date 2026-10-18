/**
 * A Medusa promotion read back into the creator's terms (the shape) and its
 * status today. Pure: no Medusa imports, the same input gives the same
 * answer, so the list, the cards and the tests agree.
 */

import { MINIMUM_ATTRIBUTES, RULE } from "./constants"
import type { CouponDto, CouponKind, CouponRuleDto, CouponShape, CouponStats, CouponStatus } from "./contract"

/** The fields of a promotion the plugin reads (Query or the promotion module). */
export interface PromotionLike {
  id: string
  code?: string | null
  type?: string | null
  status?: string | null
  is_automatic?: boolean | null
  limit?: number | null
  used?: number | null
  created_at?: string | Date | null
  campaign?: {
    id?: string | null
    name?: string | null
    starts_at?: string | Date | null
    ends_at?: string | Date | null
    budget?: { type?: string | null; limit?: number | string | null; used?: number | string | null } | null
  } | null
  application_method?: {
    type?: string | null
    target_type?: string | null
    allocation?: string | null
    value?: number | string | null
    currency_code?: string | null
    target_rules?: RuleLike[] | null
  } | null
  rules?: RuleLike[] | null
}

export interface RuleLike {
  attribute?: string | null
  operator?: string | null
  values?: Array<{ value?: string | null } | string> | null
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "object" && v !== null && "value" in (v as object) ? Number((v as { value: unknown }).value) : Number(v)
  return Number.isFinite(n) ? n : null
}

const iso = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function ruleValues(rule: RuleLike | null | undefined): string[] {
  return (rule?.values ?? [])
    .map((v) => (typeof v === "string" ? v : v?.value ?? null))
    .filter((v): v is string => typeof v === "string" && v.length > 0)
}

function kindOf(p: PromotionLike): CouponKind {
  if (p.type === "buyget") return "buy_get"
  const am = p.application_method ?? {}
  const value = num(am.value)
  if (am.target_type === "shipping_methods") {
    if (am.type === "percentage") return value !== null && value >= 100 ? "free_shipping" : "percent_shipping"
    return am.type === "fixed" ? "fixed_shipping" : "other"
  }
  if (am.target_type === "order") return am.type === "percentage" ? "percent_order" : am.type === "fixed" ? "fixed_order" : "other"
  if (am.target_type === "items") return am.type === "percentage" ? "percent_items" : am.type === "fixed" ? "fixed_items" : "other"
  return "other"
}

export function shapeOf(p: PromotionLike): CouponShape {
  const am = p.application_method ?? {}
  const rules = p.rules ?? []
  const targets = am.target_rules ?? []
  const groupIds: string[] = []
  const customerIds: string[] = []
  let minimum: number | null = null
  const salesChannelIds: string[] = []
  const regionIds: string[] = []
  const extra: CouponRuleDto[] = []
  const isIn = (r: RuleLike) => r.operator === "in" || r.operator === "eq"
  const keep = (scope: CouponRuleDto["scope"], r: RuleLike) => extra.push({ scope, attribute: r.attribute ?? "", operator: r.operator ?? "", values: ruleValues(r) })
  for (const r of rules) {
    const attr = r.attribute ?? ""
    if (attr === RULE.groups && isIn(r)) groupIds.push(...ruleValues(r))
    else if ((attr === RULE.customer || attr === RULE.customerAlt) && isIn(r)) customerIds.push(...ruleValues(r))
    else if (MINIMUM_ATTRIBUTES.includes(attr) && (r.operator === "gte" || r.operator === "gt")) minimum = num(ruleValues(r)[0])
    else if (attr === RULE.currency) continue
    else if (attr === RULE.salesChannel && isIn(r)) salesChannelIds.push(...ruleValues(r))
    else if (attr === RULE.region && isIn(r)) regionIds.push(...ruleValues(r))
    else keep("order", r)
  }
  const categoryIds: string[] = []
  const productIds: string[] = []
  const collectionIds: string[] = []
  const shippingTypeIds: string[] = []
  const shippingOptionIds: string[] = []
  for (const r of targets) {
    const attr = r.attribute ?? ""
    if (attr === RULE.category && isIn(r)) categoryIds.push(...ruleValues(r))
    else if (attr === RULE.product && isIn(r)) productIds.push(...ruleValues(r))
    else if (attr === RULE.collection && isIn(r)) collectionIds.push(...ruleValues(r))
    else if (attr === RULE.shippingType && isIn(r)) shippingTypeIds.push(...ruleValues(r))
    else if (attr === RULE.shippingOption && isIn(r)) shippingOptionIds.push(...ruleValues(r))
    else keep("target", r)
  }
  const kind = kindOf(p)
  return {
    kind,
    value: kind === "free_shipping" ? 100 : num(am.value),
    currency: am.currency_code ? String(am.currency_code).toLowerCase() : null,
    categoryIds: [...new Set(categoryIds)],
    productIds: [...new Set(productIds)],
    collectionIds: [...new Set(collectionIds)],
    shippingTypeIds: [...new Set(shippingTypeIds)],
    shippingOptionIds: [...new Set(shippingOptionIds)],
    salesChannelIds: [...new Set(salesChannelIds)],
    regionIds: [...new Set(regionIds)],
    groupIds: [...new Set(groupIds)],
    customerIds: [...new Set(customerIds)],
    minimum,
    rules: extra,
    otherRules: extra.length,
  }
}

/** Uses allowed and used: the promotion's own limit, else a usage budget of its campaign. */
export function usageOf(p: PromotionLike): { limit: number | null; used: number } {
  const own = num(p.limit)
  if (own !== null && own > 0) return { limit: own, used: num(p.used) ?? 0 }
  const b = p.campaign?.budget
  if (b && b.type === "usage") {
    const limit = num(b.limit)
    return { limit: limit !== null && limit > 0 ? limit : null, used: num(b.used) ?? num(p.used) ?? 0 }
  }
  return { limit: null, used: num(p.used) ?? 0 }
}

export function statusOf(p: PromotionLike, now: Date = new Date()): CouponStatus {
  if (p.status === "draft") return "draft"
  if (p.status === "inactive") return "paused"
  const starts = iso(p.campaign?.starts_at)
  const ends = iso(p.campaign?.ends_at)
  if (ends && new Date(ends).getTime() < now.getTime()) return "expired"
  if (starts && new Date(starts).getTime() > now.getTime()) return "scheduled"
  const { limit, used } = usageOf(p)
  if (limit !== null && used >= limit) return "used_up"
  return "active"
}

export const NO_STATS: CouponStats = { orders: 0, discount: 0, revenue: 0, newCustomers: 0, lastUsedAt: null }

export function toCouponDto(p: PromotionLike, stats: CouponStats | undefined, now: Date = new Date()): CouponDto {
  const usage = usageOf(p)
  const limit = usage.limit
  /* Medusa counts a use only for its own adjustments; orders found by the reads (also the
     store's own rows, option codeInDescription) are uses too, so the larger number wins. */
  const used = Math.max(usage.used, stats?.orders ?? 0)
  return {
    id: p.id,
    code: p.code ?? "",
    automatic: p.is_automatic === true,
    status: statusOf(p, now),
    medusaStatus: p.status ?? "active",
    shape: shapeOf(p),
    startsAt: iso(p.campaign?.starts_at),
    endsAt: iso(p.campaign?.ends_at),
    limit,
    used,
    campaign: p.campaign?.id ? { id: p.campaign.id, name: p.campaign.name ?? "" } : null,
    stats: stats ?? NO_STATS,
    createdAt: iso(p.created_at),
  }
}

/** A coupon reaches a product: no item target at all, or the product, one of its categories or its collection is targeted. */
export function reachesProduct(shape: CouponShape, productId: string, categoryIds: readonly string[], collectionId: string | null = null): boolean {
  if (["free_shipping", "percent_shipping", "fixed_shipping", "other", "buy_get"].includes(shape.kind)) return false
  const collections = shape.collectionIds ?? []
  if (shape.productIds.length === 0 && shape.categoryIds.length === 0 && collections.length === 0) return true
  if (shape.productIds.includes(productId)) return true
  if (collectionId && collections.includes(collectionId)) return true
  return shape.categoryIds.some((c) => categoryIds.includes(c))
}

/** A coupon is for a customer: no audience rule, or the customer, or one of their groups. */
export function isForCustomer(shape: CouponShape, customerId: string, groupIds: readonly string[]): boolean {
  if (shape.customerIds.length === 0 && shape.groupIds.length === 0) return false
  if (shape.customerIds.includes(customerId)) return true
  return shape.groupIds.some((g) => groupIds.includes(g))
}
