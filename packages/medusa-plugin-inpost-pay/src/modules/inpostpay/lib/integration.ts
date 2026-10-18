import type { CounterDraft, FactDraft, SummaryDraft } from "./kit-routes"
import { paymentProblem } from "./store"

/**
 * InPost Pay in the koda.integration/1 contract, as pure functions over the
 * plugin's own basket rows (never order or cart metadata): one line per
 * order that came through InPost Pay, and the board counters.
 */

export interface OrderRow {
  order_id: string
  demo: boolean
  status: string
  payment_status: string | null
  order_status: string | null
  delivery_type: string | null
  delivery_point: string | null
  masked_phone: string | null
  updated_at: string | Date | null
}

export function orderSummary(row: OrderRow | undefined): SummaryDraft | undefined {
  if (!row) return undefined
  const link = { kind: "admin" as const, href: `/inpostpay?q=${encodeURIComponent(row.order_id)}` }
  const facts: FactDraft[] = []
  const cod = row.payment_status === "COD"
  facts.push({ slot: "payment", priority: 10, ...(cod ? { code: "cod" } : {}), value: { key: "integration.fact.method" }, ...(row.masked_phone ? { sub: { key: "integration.fact.phone", params: { phone: row.masked_phone } } } : {}) })
  if (row.delivery_type === "APM" && row.delivery_point) facts.push({ slot: "delivery", priority: 20, value: { key: "integration.fact.locker", params: { point: row.delivery_point } } })
  else if (row.delivery_type === "COURIER") facts.push({ slot: "delivery", priority: 20, value: { key: "integration.fact.courier" } })
  else if (row.delivery_type === "DIGITAL") facts.push({ slot: "delivery", priority: 20, value: { key: "integration.fact.digital" } })

  const base = { facts, links: [link], updatedAt: row.updated_at ?? null }
  if (row.order_status === "ORDER_REJECTED") return { ...base, state: "failed", title: { key: "integration.order.rejected" } }
  if (paymentProblem(row.payment_status)) return { ...base, state: "failed", title: { key: "integration.order.failed", params: { status: String(row.payment_status) } } }
  if (row.demo) return { ...base, state: "ok", title: { key: "integration.order.demo" } }
  if (row.payment_status === "AUTHORIZED") return { ...base, state: "ok", title: { key: "integration.order.paid" } }
  if (cod) return { ...base, state: "ok", title: { key: "integration.order.cod" } }
  return { ...base, state: "active", title: { key: "integration.order.pending", params: { status: row.payment_status ?? "UNPAID" } } }
}

/** The board counters: orders whose payment failed (red), baskets whose order failed (orange). */
export function inpostPayCounters(c: { paymentProblems: number; failedBaskets: number }): CounterDraft[] {
  return [
    { key: "payment_problems", scope: "orders", count: c.paymentProblems, tone: "red", link: { kind: "admin", href: "/inpostpay?filter=payment_problems" }, entity: "order" },
    { key: "failed_baskets", scope: "orders", count: c.failedBaskets, tone: "orange", link: { kind: "admin", href: "/inpostpay?filter=failed" } },
  ]
}
