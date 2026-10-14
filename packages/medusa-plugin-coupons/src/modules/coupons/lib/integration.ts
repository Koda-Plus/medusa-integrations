import type { CounterDraft, SummaryDraft } from "./kit-routes"

/**
 * Coupons in the koda.integration/1 contract, as pure functions over rows
 * the plugin read from Medusa (promotion adjustments of orders, promotions):
 * one line per order, per customer and per product, and the board counters.
 * Facts never come from order or cart metadata.
 */

export interface AppliedRow {
  code: string | null
  discount: number
}

/** The line of one order: which coupons worked and what they gave. Undefined when none did. */
export function orderSummary(id: string, applied: AppliedRow[], money: (n: number) => string): SummaryDraft | undefined {
  if (applied.length === 0) return undefined
  const total = applied.reduce((s, a) => s + a.discount, 0)
  const codes = [...new Set(applied.map((a) => a.code).filter((c): c is string => Boolean(c)))]
  return {
    state: "ok",
    title:
      codes.length <= 1
        ? { key: "integration.order.one", params: { code: codes[0] ?? "", amount: money(total) } }
        : { key: "integration.order.many", params: { count: codes.length, amount: money(total) } },
    links: [{ kind: "admin", href: codes[0] ? `/coupons?q=${encodeURIComponent(codes[0])}` : "/coupons" }],
    counts: { coupons: Math.max(codes.length, 1) },
  }
}

export interface CustomerUseRow {
  codes: number
  discount: number
}

/** The line of one customer: how many codes they used and what it saved them. */
export function customerSummary(id: string, use: CustomerUseRow | undefined, money: (n: number) => string): SummaryDraft | undefined {
  if (!use || use.codes === 0) return undefined
  return {
    state: "ok",
    title: { key: "integration.customer.used", params: { count: use.codes } },
    detail: { key: "integration.customer.saved", params: { amount: money(use.discount) } },
    links: [{ kind: "admin", href: "/coupons" }],
    counts: { coupons: use.codes },
  }
}

/** The line of one product: active coupons that reach it. */
export function productSummary(id: string, active: number): SummaryDraft | undefined {
  if (active === 0) return undefined
  return {
    state: "active",
    title: { key: "integration.product.active", params: { count: active } },
    links: [{ kind: "admin", href: "/coupons?status=active" }],
    counts: { coupons: active },
  }
}

/** The board: coupons ending soon (blue) and automatic coupons for everyone (orange). */
export function couponsCounters(c: { expiring: number; automaticForEveryone: number }): CounterDraft[] {
  return [
    { key: "expiring", scope: "integration", count: c.expiring, tone: "blue", link: { kind: "admin", href: "/coupons?status=expiring" } },
    { key: "automatic_everyone", scope: "integration", count: c.automaticForEveryone, tone: "orange", link: { kind: "admin", href: "/coupons?status=automatic" } },
  ]
}
