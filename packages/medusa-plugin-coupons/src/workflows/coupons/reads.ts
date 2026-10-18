/**
 * THE READS of Coupons by Koda Plus: promotions through Query, their use
 * through the promotion adjustments Medusa keeps on order lines and
 * shipping methods, names through Query. Nothing here writes.
 *
 * Use is counted from orders, not from the promotion's `used` counter: an
 * order that was canceled is left out, and the revenue, the first orders of
 * new customers and the latest use come with it. Canceled orders never count.
 */

import { DETAIL_ORDERS, EXPIRING_DAYS, LIST_LIMIT } from "../../modules/coupons/lib/constants"
import type { CouponDto, CouponOrderDto, CouponStats, CouponTiles, CustomerHit, NameMaps } from "../../modules/coupons/lib/contract"
import { isForCustomer, reachesProduct, toCouponDto, type PromotionLike } from "../../modules/coupons/lib/describe"
import { customerModule, num, queryOf, sqlOf, str, type Scope, couponsService } from "./runtime"

export const PROMOTION_FIELDS = [
  "id",
  "code",
  "type",
  "status",
  "is_automatic",
  "limit",
  "used",
  "created_at",
  "campaign.id",
  "campaign.name",
  "campaign.starts_at",
  "campaign.ends_at",
  "campaign.budget.type",
  "campaign.budget.limit",
  "campaign.budget.used",
  "application_method.type",
  "application_method.target_type",
  "application_method.allocation",
  "application_method.value",
  "application_method.currency_code",
  "application_method.target_rules.attribute",
  "application_method.target_rules.operator",
  "application_method.target_rules.values.value",
  "rules.attribute",
  "rules.operator",
  "rules.values.value",
]

export async function readPromotions(scope: Scope, filters: Record<string, unknown> = {}, take = LIST_LIMIT): Promise<PromotionLike[]> {
  const { data } = await queryOf(scope).graph({
    entity: "promotion",
    fields: PROMOTION_FIELDS,
    filters,
    pagination: { take, skip: 0, order: { created_at: "DESC" } },
  })
  return (data ?? []) as PromotionLike[]
}

/* ------------------------------------------------------------------ */
/* Use from orders                                                     */
/* ------------------------------------------------------------------ */

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ")

/**
 * Every promotion adjustment of a non-canceled order in its current version,
 * on items and on shipping, with the order's customer and date. `where` adds
 * conditions on `o` (the order) and `x` (the adjustment) to both halves;
 * it gets the expression of the adjustment's promotion id to filter on.
 *
 * With the option codeInDescription an adjustment without a promotion id
 * whose description starts with a coupon's code and a colon counts as that
 * coupon's: stores that write their own rows that way keep them out of
 * Medusa's refresh, which would otherwise remove them.
 */
function adjustments(scope: Scope, where: (pid: string) => string): string {
  const own = couponsService(scope).getOptions().codeInDescription
  const pid = own ? "coalesce(x.promotion_id, pd.id)" : "x.promotion_id"
  const code = own ? "coalesce(x.code, pd.code)" : "x.code"
  const join = own
    ? `left join promotion pd on x.promotion_id is null and position(':' in coalesce(x.description, '')) > 1
        and pd.code = split_part(x.description, ':', 1) and pd.deleted_at is null`
    : ""
  return `adj as (
    select ${pid} as promotion_id, ${code} as code, oi.order_id, x.amount::numeric as amount, 'items' as part, o.customer_id, o.created_at, o.currency_code
    from order_line_item_adjustment x
    ${join}
    join order_item oi on oi.item_id = x.item_id and oi.deleted_at is null
    join "order" o on o.id = oi.order_id and o.version = oi.version and o.deleted_at is null and o.status <> 'canceled'
    where x.deleted_at is null and ${where(pid)}
    union all
    select ${pid} as promotion_id, ${code} as code, os.order_id, x.amount::numeric as amount, 'shipping' as part, o.customer_id, o.created_at, o.currency_code
    from order_shipping_method_adjustment x
    ${join}
    join order_shipping os on os.shipping_method_id = x.shipping_method_id and os.deleted_at is null
    join "order" o on o.id = os.order_id and o.version = os.version and o.deleted_at is null and o.status <> 'canceled'
    where x.deleted_at is null and ${where(pid)}
  )`
}

/** The customer had no earlier, non-canceled order: this one is their first. */
const FIRST_ORDER = `(o.customer_id is not null and not exists (
  select 1 from "order" p where p.customer_id = o.customer_id and p.deleted_at is null and p.status <> 'canceled' and p.created_at < o.created_at))`

export async function statsFor(scope: Scope, promotionIds: string[]): Promise<Map<string, CouponStats>> {
  const out = new Map<string, CouponStats>()
  if (promotionIds.length === 0) return out
  const ids = promotionIds.slice(0, LIST_LIMIT)
  /* The same ids for both halves of the union. */
  const sql = `with ${adjustments(scope, (pid) => `${pid} in (${marks(ids.length)})`)},
    per_order as (select promotion_id, order_id, sum(amount) as discount from adj group by promotion_id, order_id)
    select po.promotion_id,
      count(*)::int as orders,
      coalesce(sum(po.discount), 0)::float as discount,
      coalesce(sum((s.totals->>'current_order_total')::numeric), 0)::float as revenue,
      count(*) filter (where ${FIRST_ORDER})::int as new_customers,
      max(o.created_at) as last_at
    from per_order po
    join "order" o on o.id = po.order_id
    left join order_summary s on s.order_id = o.id and s.version = o.version and s.deleted_at is null
    group by po.promotion_id`
  const r = await sqlOf(scope).raw(sql, [...ids, ...ids])
  for (const row of r.rows ?? []) {
    out.set(String(row.promotion_id), {
      orders: num(row.orders),
      discount: Math.round(num(row.discount) * 100) / 100,
      revenue: Math.round(num(row.revenue) * 100) / 100,
      newCustomers: num(row.new_customers),
      lastUsedAt: row.last_at ? new Date(row.last_at).toISOString() : null,
    })
  }
  return out
}

/** Orders with any coupon and the discount they got, in the last 30 days. */
async function last30Days(scope: Scope): Promise<{ orders: number; discount: number }> {
  const sql = `with ${adjustments(scope, (pid) => `${pid} is not null and o.created_at > now() - interval '30 days'`)}
    select count(distinct order_id)::int as orders, coalesce(sum(amount), 0)::float as discount from adj`
  const r = await sqlOf(scope).raw(sql)
  const row = r.rows?.[0] ?? {}
  return { orders: num(row.orders), discount: Math.round(num(row.discount) * 100) / 100 }
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

export function emptyNames(): NameMaps {
  return { groups: {}, categories: {}, products: {}, customers: {} }
}

async function nameMap(scope: Scope, entity: string, ids: string[], label: (row: Record<string, unknown>) => string | null, fields: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const unique = [...new Set(ids)].slice(0, 500)
  if (unique.length === 0) return out
  try {
    const { data } = await queryOf(scope).graph({ entity, fields: ["id", ...fields], filters: { id: unique } })
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const id = str(row.id)
      const name = label(row)
      if (id && name) out[id] = name
    }
  } catch {
    /* a missing name reads as the id in the admin */
  }
  return out
}

export function customerLabel(row: Record<string, unknown>): string | null {
  const person = [str(row.first_name), str(row.last_name)].filter(Boolean).join(" ")
  return str(row.company_name) ?? (person || null) ?? str(row.email)
}

export async function namesFor(scope: Scope, coupons: CouponDto[]): Promise<NameMaps> {
  const groups = coupons.flatMap((c) => c.shape.groupIds)
  const categories = coupons.flatMap((c) => c.shape.categoryIds)
  const products = coupons.flatMap((c) => c.shape.productIds)
  const customers = coupons.flatMap((c) => c.shape.customerIds)
  const ids = (k: "collectionIds" | "shippingTypeIds" | "shippingOptionIds" | "salesChannelIds" | "regionIds") => coupons.flatMap((c) => c.shape[k] ?? [])
  const [g, cat, p, cus, col, st, so, sc, reg] = await Promise.all([
    nameMap(scope, "customer_group", groups, (r) => str(r.name), ["name"]),
    nameMap(scope, "product_category", categories, (r) => str(r.name), ["name"]),
    nameMap(scope, "product", products, (r) => str(r.title), ["title"]),
    nameMap(scope, "customer", customers, customerLabel, ["email", "first_name", "last_name", "company_name"]),
    nameMap(scope, "product_collection", ids("collectionIds"), (r) => str(r.title), ["title"]),
    nameMap(scope, "shipping_option_type", ids("shippingTypeIds"), (r) => str(r.label), ["label"]),
    nameMap(scope, "shipping_option", ids("shippingOptionIds"), (r) => str(r.name), ["name"]),
    nameMap(scope, "sales_channel", ids("salesChannelIds"), (r) => str(r.name), ["name"]),
    nameMap(scope, "region", ids("regionIds"), (r) => str(r.name), ["name"]),
  ])
  /* The store's own rules (option storeRules), never a reason for the page to fail. */
  let storeRules: NameMaps["storeRules"] = {}
  const resolver = couponsService(scope).getOptions().storeRules
  if (resolver && coupons.length) {
    try {
      storeRules = (await resolver(scope, [...new Set(coupons.map((c) => c.id))])) ?? {}
    } catch {
      storeRules = {}
    }
  }
  return { groups: g, categories: cat, products: p, customers: cus, collections: col, shippingTypes: st, shippingOptions: so, salesChannels: sc, regions: reg, storeRules }
}

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

export async function listCoupons(scope: Scope, now: Date = new Date()): Promise<{ coupons: CouponDto[]; names: NameMaps; tiles: CouponTiles }> {
  const promotions = await readPromotions(scope)
  const stats = await statsFor(scope, promotions.map((p) => p.id))
  const coupons = promotions.map((p) => toCouponDto(p, stats.get(p.id), now))
  const [names, recent] = await Promise.all([namesFor(scope, coupons), last30Days(scope)])
  const soon = now.getTime() + EXPIRING_DAYS * 24 * 3600 * 1000
  const tiles: CouponTiles = {
    active: coupons.filter((c) => c.status === "active").length,
    scheduled: coupons.filter((c) => c.status === "scheduled").length,
    orders30d: recent.orders,
    discount30d: recent.discount,
    expiringSoon: coupons.filter((c) => c.status === "active" && c.endsAt && new Date(c.endsAt).getTime() <= soon).length,
    automaticForEveryone: coupons.filter((c) => c.status === "active" && c.automatic && c.shape.groupIds.length === 0 && c.shape.customerIds.length === 0).length,
  }
  return { coupons, names, tiles }
}

export async function couponDetail(scope: Scope, id: string, now: Date = new Date()): Promise<{ coupon: CouponDto; names: NameMaps; orders: CouponOrderDto[] } | null> {
  const [promotion] = await readPromotions(scope, { id }, 1)
  if (!promotion) return null
  const stats = await statsFor(scope, [promotion.id])
  const coupon = toCouponDto(promotion, stats.get(promotion.id), now)
  const sql = `with ${adjustments(scope, (pid) => `${pid} = ?`)},
    per_order as (select order_id, sum(amount) as discount from adj group by order_id)
    select o.id, o.display_id, o.created_at, o.email, o.currency_code, po.discount::float as discount,
      coalesce((s.totals->>'current_order_total')::numeric, 0)::float as total,
      ${FIRST_ORDER} as first_order
    from per_order po
    join "order" o on o.id = po.order_id
    left join order_summary s on s.order_id = o.id and s.version = o.version and s.deleted_at is null
    order by o.created_at desc
    limit ${DETAIL_ORDERS}`
  const r = await sqlOf(scope).raw(sql, [promotion.id, promotion.id])
  const orders: CouponOrderDto[] = (r.rows ?? []).map((row) => ({
    id: String(row.id),
    displayId: row.display_id === null || row.display_id === undefined ? null : num(row.display_id),
    createdAt: new Date(row.created_at).toISOString(),
    customer: str(row.email),
    discount: Math.round(num(row.discount) * 100) / 100,
    total: Math.round(num(row.total) * 100) / 100,
    currency: String(row.currency_code ?? "").toUpperCase(),
    firstOrder: row.first_order === true,
  }))
  return { coupon, names: await namesFor(scope, [coupon]), orders }
}

export async function lookups(scope: Scope, memberGroupIds: readonly string[], fallbackCurrency: string) {
  const q = queryOf(scope)
  const [groups, categories, stores] = await Promise.all([
    q.graph({ entity: "customer_group", fields: ["id", "name"], pagination: { take: 200, skip: 0 } }).then((r) => r.data as Array<Record<string, unknown>>).catch(() => []),
    q.graph({ entity: "product_category", fields: ["id", "name"], pagination: { take: 500, skip: 0 } }).then((r) => r.data as Array<Record<string, unknown>>).catch(() => []),
    q.graph({ entity: "store", fields: ["id", "supported_currencies.currency_code", "supported_currencies.is_default"] }).then((r) => r.data as Array<Record<string, unknown>>).catch(() => []),
  ])
  const currencies = new Set<string>()
  let defaultCurrency: string | null = null
  for (const s of stores) {
    for (const c of (s.supported_currencies as Array<Record<string, unknown>> | undefined) ?? []) {
      const code = str(c.currency_code)?.toLowerCase()
      if (!code) continue
      currencies.add(code)
      if (c.is_default === true) defaultCurrency = code
    }
  }
  return {
    groups: groups.map((g) => ({ id: String(g.id), name: str(g.name) ?? String(g.id), member: memberGroupIds.includes(String(g.id)) })).sort((a, b) => a.name.localeCompare(b.name)),
    categories: categories.map((c) => ({ id: String(c.id), name: str(c.name) ?? String(c.id) })).sort((a, b) => a.name.localeCompare(b.name)),
    currencies: currencies.size ? [...currencies] : [fallbackCurrency],
    currencyCode: currencies.has(fallbackCurrency) ? fallbackCurrency : defaultCurrency ?? fallbackCurrency,
  }
}

export async function searchCustomers(scope: Scope, q: string): Promise<CustomerHit[]> {
  const term = q.trim().slice(0, 80)
  if (term.length < 2) return []
  const rows = await customerModule(scope).listCustomers({ q: term }, { take: 10 })
  return rows.map((c) => ({ id: c.id, email: c.email ?? "", name: customerLabel(c as Record<string, unknown>) }))
}

/* ------------------------------------------------------------------ */
/* Cards on the customer, the order and the product                    */
/* ------------------------------------------------------------------ */

export async function customerCoupons(scope: Scope, customerId: string, now: Date = new Date()) {
  const sql = `with ${adjustments(scope, () => `o.customer_id = ?`)}
    select coalesce(code, '') as code, max(promotion_id) as promotion_id, count(distinct order_id)::int as orders,
      coalesce(sum(amount), 0)::float as discount, max(created_at) as last_at, max(currency_code) as currency_code
    from adj group by coalesce(code, '') order by max(created_at) desc limit 20`
  const r = await sqlOf(scope).raw(sql, [customerId, customerId])
  const used = (r.rows ?? []).map((row) => ({
    code: String(row.code ?? ""),
    promotionId: str(row.promotion_id),
    orders: num(row.orders),
    discount: Math.round(num(row.discount) * 100) / 100,
    lastAt: row.last_at ? new Date(row.last_at).toISOString() : null,
  }))
  const currency = String(r.rows?.[0]?.currency_code ?? "").toUpperCase()

  let groupIds: string[] = []
  try {
    const { data } = await queryOf(scope).graph({ entity: "customer", fields: ["id", "groups.id"], filters: { id: customerId } })
    const row = (data?.[0] ?? {}) as { groups?: Array<{ id?: string }> }
    groupIds = (row.groups ?? []).map((g) => String(g.id ?? "")).filter(Boolean)
  } catch {
    groupIds = []
  }
  const promotions = await readPromotions(scope)
  const forThem = promotions
    .map((p) => toCouponDto(p, undefined, now))
    .filter((c) => (c.status === "active" || c.status === "scheduled") && isForCustomer(c.shape, customerId, groupIds))
    .slice(0, 10)
  return { used, forThem, names: await namesFor(scope, forThem), currency }
}

export async function orderCoupons(scope: Scope, orderId: string) {
  const sql = `with ${adjustments(scope, () => `o.id = ?`)}
    select code, promotion_id, part, coalesce(sum(amount), 0)::float as discount, max(currency_code) as currency_code
    from adj group by code, promotion_id, part order by discount desc`
  const r = await sqlOf(scope).raw(sql, [orderId, orderId])
  const applied = (r.rows ?? []).map((row) => ({
    code: str(row.code),
    promotionId: str(row.promotion_id),
    discount: Math.round(num(row.discount) * 100) / 100,
    on: (row.part === "shipping" ? "shipping" : "items") as "items" | "shipping",
  }))
  return {
    applied,
    total: Math.round(applied.reduce((s, a) => s + a.discount, 0) * 100) / 100,
    currency: String(r.rows?.[0]?.currency_code ?? "").toUpperCase(),
  }
}

export async function productCoupons(scope: Scope, productId: string, now: Date = new Date()) {
  let categoryIds: string[] = []
  let collectionId: string | null = null
  try {
    const { data } = await queryOf(scope).graph({ entity: "product", fields: ["id", "collection_id", "categories.id"], filters: { id: productId } })
    const row = (data?.[0] ?? {}) as { collection_id?: string | null; categories?: Array<{ id?: string }> }
    categoryIds = (row.categories ?? []).map((c) => String(c.id ?? "")).filter(Boolean)
    collectionId = row.collection_id ?? null
  } catch {
    categoryIds = []
  }
  const promotions = await readPromotions(scope)
  const coupons = promotions
    .map((p) => toCouponDto(p, undefined, now))
    .filter((c) => c.status === "active" && reachesProduct(c.shape, productId, categoryIds, collectionId))
    .slice(0, 15)
  return { coupons, names: await namesFor(scope, coupons) }
}
