import type { CounterDraft, SummaryDraft } from "./kit-routes"

/**
 * Trade Credit in the koda.integration/1 contract, as pure functions over
 * the plugin's own rows: one line per customer with credit terms, and the
 * board counter. Money arrives as strings, formatted by the caller.
 */

/** What the summary needs of a limit. */
export interface LimitRow {
  blocked: boolean
  exhausted: boolean
  used_amount: number
  limit_amount: number
  remaining_amount: number
  net_days: number
}

/** The line of one customer from their limit and overdue orders. Undefined without a limit. */
export function customerSummary(id: string, limit: LimitRow | undefined, overdue: number, money: (n: number) => string): SummaryDraft | undefined {
  if (!limit) return undefined
  const links = [{ kind: "admin" as const, href: "/credit" }]
  if (limit.blocked) return { state: "failed", title: { key: "integration.customer.blocked" }, links }
  if (overdue > 0) return { state: "failed", title: { key: "integration.customer.overdue", params: { count: overdue } }, links }
  if (limit.exhausted) return { state: "attention", title: { key: "integration.customer.exhausted", params: { used: money(limit.used_amount), limit: money(limit.limit_amount) } }, links }
  if (limit.used_amount > 0) return { state: "active", title: { key: "integration.customer.used", params: { used: money(limit.used_amount), limit: money(limit.limit_amount), remaining: money(limit.remaining_amount) } }, links }
  return { state: "ok", title: { key: "integration.customer.ready", params: { limit: money(limit.limit_amount) } }, links }
}

/** The board counter: limits that need a look (blocked or exhausted). */
export function creditCounters(c: { attention: number }): CounterDraft[] {
  return [
    {
      key: "to_check",
      scope: "customers",
      count: c.attention,
      tone: "orange",
      link: { kind: "admin", href: "/credit" },
      entity: "customer",
    },
  ]
}
