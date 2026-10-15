import { NET_DAYS } from "./constants"
import type { CreditOrderDto, LimitDto, StatusResponse } from "./contract"
import type { CreditStoreAdapter, StoreCreditAccount, StoreCreditOrder } from "./store-adapter"

/**
 * Store mode (option `store`): the store's accounts and orders as the page's
 * DTOs. In this mode a limit's id is the customer id (the store keeps no rows
 * of the plugin), so the page and the routes address an account by it.
 */

const round2 = (n: number) => Math.round(n * 100) / 100

export function accountToLimit(a: StoreCreditAccount): LimitDto {
  const limit = a.limit_amount ?? 0
  const remaining = a.limit_amount != null ? Math.max(0, round2(a.limit_amount - a.used_amount)) : 0
  return {
    id: a.customer_id,
    customer_id: a.customer_id,
    customer_email: a.email,
    customer_name: a.name,
    currency_code: "pln",
    limit_amount: limit,
    used_amount: round2(a.used_amount),
    remaining_amount: remaining,
    net_days: a.net_days,
    status: a.paused ? "paused" : "active",
    blocked: a.blocked === true,
    exhausted: a.limit_amount != null && a.limit_amount > 0 && a.used_amount >= a.limit_amount - 0.005,
    demo: false,
    updated_at: new Date().toISOString(),
    overdue_amount: round2(a.overdue_amount),
    oldest_overdue_days: a.oldest_overdue_days,
    open_orders: a.open_orders,
    no_limit: a.limit_amount == null,
    company: a.company ?? null,
    note: a.note ?? null,
  }
}

export function storeOrderToDto(o: StoreCreditOrder): CreditOrderDto {
  return {
    id: o.order_id,
    order_id: o.order_id,
    display_id: o.display_id,
    customer_id: o.customer_id,
    currency_code: "pln",
    total_amount: round2(o.total_amount),
    net_days: 0,
    due_at: o.due_at ? `${o.due_at}T23:59:59.000Z` : "",
    paid_at: null,
    state: o.overdue_days > 0 ? "overdue" : "open",
    demo: false,
    unpaid_amount: round2(o.unpaid_amount),
    overdue_days: o.overdue_days,
    document: o.document ?? null,
    payment_label: o.payment_label ?? null,
    reminded_at: o.reminded_at ?? null,
    placed_by: o.placed_by ?? null,
    no_due_date: !o.due_at,
  }
}

export async function storeStatus(scope: unknown, store: CreditStoreAdapter): Promise<StatusResponse> {
  const [accounts, orders] = await Promise.all([store.accounts(scope), store.orders(scope)])
  const limits = accounts.map(accountToLimit)
  const dtos = orders.map(storeOrderToDto)
  return {
    demo: false,
    enforce: false,
    mode: "store",
    capabilities: { block: store.capabilities?.block === true, pause: store.capabilities?.pause === true },
    netDayChoices: store.netDayChoices?.length ? store.netDayChoices : [...NET_DAYS],
    maxNetDays: store.maxNetDays ?? 365,
    ruleText: store.ruleText ?? null,
    markPaidPath: store.markPaidPath ?? null,
    counts: {
      limits: limits.filter((l) => !l.no_limit || l.net_days > 0).length,
      blocked: limits.filter((l) => l.blocked).length,
      exhausted: limits.filter((l) => l.exhausted).length,
      overdue: dtos.filter((o) => o.state === "overdue").length,
      used_total: round2(limits.reduce((n, l) => n + l.used_amount, 0)),
      overdue_total: round2(limits.reduce((n, l) => n + (l.overdue_amount ?? 0), 0)),
    },
    limits,
    orders: dtos,
  }
}
