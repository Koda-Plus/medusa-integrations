import type { CounterDraft, FactDraft, SummaryDraft } from "./kit-routes"

/**
 * InPost Von Halsky in the koda.integration/1 contract, as pure functions
 * over the plugin's own rows (never order or product metadata): one line
 * per Medusa order that came from the marketplace, one line per product
 * with offers, and the board counters.
 */

export interface OrderRow {
  order_id: string
  marketplace_order_id: string
  demo: boolean
  delivery_type: string | null
  delivery_point: string | null
  payment_type: string | null
  tracking_status: string
  tracking_numbers: string[]
  returns_count?: number
  claims_count?: number
  updated_at: string | Date | null
}

export function orderSummary(row: OrderRow | undefined): SummaryDraft | undefined {
  if (!row) return undefined
  const link = { kind: "admin" as const, href: `/vonhalsky?section=orders&q=${encodeURIComponent(row.marketplace_order_id)}` }
  const cod = row.payment_type === "CASH_ON_DELIVERY"
  const facts: FactDraft[] = [
    { slot: "channel", priority: 60, code: "vonhalsky", value: { key: "integration.fact.channel" }, sub: { key: "integration.fact.orderId", params: { id: row.marketplace_order_id } } },
    cod
      ? { slot: "payment", priority: 40, code: "cod", value: { key: "integration.fact.cod" } }
      : { slot: "payment", priority: 40, code: "paid", value: { key: "integration.fact.paid" } },
  ]
  if (row.delivery_type === "APM" && row.delivery_point) facts.push({ slot: "delivery", priority: 30, value: { key: "integration.fact.locker", params: { point: row.delivery_point } } })
  else if (row.delivery_type === "COURIER") facts.push({ slot: "delivery", priority: 30, value: { key: "integration.fact.courier" } })
  if (row.tracking_numbers.length > 0) {
    facts.push({ slot: "delivery", priority: 25, value: { key: "integration.fact.tracking", params: { numbers: row.tracking_numbers.slice(0, 3).join(", ") } } })
  }
  const returns = row.returns_count ?? 0
  const claims = row.claims_count ?? 0
  if (returns + claims > 0) facts.push({ slot: "channel", priority: 35, code: "after_sale", value: { key: "integration.fact.afterSale", params: { returns, claims } } })
  const base = { facts, links: [link], widget: "vonhalsky.order", updatedAt: row.updated_at ?? null }
  if (row.tracking_status === "waiting") return { ...base, state: "attention", title: { key: "integration.order.trackingWaiting" } }
  if (row.tracking_status === "linked") return { ...base, state: "ok", title: { key: row.demo ? "integration.order.trackingDemo" : "integration.order.trackingLinked" } }
  if (row.demo) return { ...base, state: "active", title: { key: "integration.order.demo" } }
  return { ...base, state: "active", title: { key: "integration.order.awaiting" } }
}

export interface ProductOfferRow {
  product_id: string
  status: string
  reasons: string[]
  demo: boolean
  updated_at: string | Date | null
}

export function productSummary(productId: string, rows: ProductOfferRow[]): SummaryDraft | undefined {
  if (rows.length === 0) return undefined
  const link = { kind: "admin" as const, href: `/vonhalsky?section=offers&q=${encodeURIComponent(productId)}` }
  const listed = rows.filter((r) => r.status === "listed").length
  const blocked = rows.filter((r) => r.status === "blocked")
  const draft = rows.filter((r) => r.status === "draft").length
  const updatedAt = rows.map((r) => (r.updated_at ? new Date(r.updated_at).getTime() : 0)).reduce((a, b) => Math.max(a, b), 0)
  const facts: FactDraft[] = [{ slot: "listing", priority: 50, code: "vonhalsky", value: { key: "integration.fact.offers", params: { listed, total: rows.length } } }]
  const base = { facts, links: [link], counts: { listed, blocked: blocked.length, draft }, updatedAt: updatedAt ? new Date(updatedAt) : null }
  if (blocked.length > 0) {
    const reason = blocked[0].reasons[0] ?? "unknown"
    return { ...base, state: "attention", title: { key: "integration.product.blocked", params: { count: blocked.length } }, detail: { key: `integration.reason.${reason}` } }
  }
  if (listed > 0) return { ...base, state: "ok", title: { key: "integration.product.listed", params: { count: listed } } }
  if (draft > 0) return { ...base, state: "active", title: { key: "integration.product.draft", params: { count: draft } } }
  return { ...base, state: "none", title: { key: "integration.product.closed" } }
}

/**
 * The board counters: imports that are held (red), shipments InPost has not
 * linked yet and open returns or claims (orange), blocked offers (orange),
 * orders to ship (blue).
 */
export function vonHalskyCounters(c: { held: number; trackingWaiting: number; openCases: number; blockedOffers: number; awaitingShipment: number }): CounterDraft[] {
  return [
    { key: "held_orders", scope: "orders", count: c.held, tone: "red", link: { kind: "admin", href: "/vonhalsky?section=orders&filter=held" } },
    { key: "tracking_waiting", scope: "orders", count: c.trackingWaiting, tone: "orange", link: { kind: "admin", href: "/vonhalsky?section=orders&filter=tracking_waiting" }, entity: "order" },
    { key: "open_cases", scope: "orders", count: c.openCases, tone: "orange", link: { kind: "admin", href: "/vonhalsky?section=after-sale" } },
    { key: "awaiting_shipment", scope: "orders", count: c.awaitingShipment, tone: "blue", link: { kind: "admin", href: "/vonhalsky?section=orders&filter=awaiting_shipment" }, entity: "order" },
    { key: "blocked_offers", scope: "products", count: c.blockedOffers, tone: "orange", link: { kind: "admin", href: "/vonhalsky?section=offers&filter=blocked" } },
  ]
}
