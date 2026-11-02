/**
 * InPost Von Halsky in the koda.integration/1 contract: the shared
 * conformance checks with a fake scope (orders and products), then the
 * plugin's own promises: an order that did not come from the marketplace
 * has no line, a shipment InPost does not show yet needs a person, a linked
 * one reads ok, returns and claims show on the order, a blocked variant
 * makes the product wait for a person, and the counters (held imports,
 * shipments waiting for InPost, open after sale cases, orders to ship,
 * blocked offers) count the right rows and link to the filters of the page.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { vonHalskyIntegration } from "../src/workflows/vonhalsky/integration.ts"
import { orderSummary, productSummary, vonHalskyCounters, type OrderRow } from "../src/modules/vonhalsky/lib/integration.ts"
import { makeContext } from "../src/modules/vonhalsky/lib/kit-routes.ts"
import { resolveOptions } from "../src/modules/vonhalsky/lib/options.ts"
import { conformance } from "./kit-conformance.ts"

type Row = Record<string, unknown>

const isNull = (v: unknown): boolean => v === null || v === undefined

/**
 * One filter value the way the database reads it: a list is IN, `null` is
 * IS NULL, `$nin` is NOT IN and `$ne` is <> (a null column matches neither,
 * as in SQL; `$ne: null` is IS NOT NULL), anything else is equality.
 */
function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined) return true
  if (filter === null) return isNull(value)
  if (Array.isArray(filter)) return filter.includes(value)
  if (typeof filter === "object") {
    const f = filter as Record<string, unknown>
    if ("$nin" in f) return !isNull(value) && Array.isArray(f.$nin) && !f.$nin.includes(value)
    if ("$ne" in f) return f.$ne === null ? !isNull(value) : !isNull(value) && value !== f.$ne
    throw new Error(`the fake scope does not know the filter ${JSON.stringify(filter)}`)
  }
  return value === filter
}

function matchesAll(row: Row, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([k, v]) => {
    if (k === "$or") return Array.isArray(v) && v.some((sub) => matchesAll(row, sub as Record<string, unknown>))
    return matches(row[k], v)
  })
}

function fakeScope(orders: Row[], offers: Row[], cases: Row[]) {
  const writes: unknown[] = []
  const filtered = (rows: Row[], filters: Record<string, unknown> = {}) => rows.filter((r) => matchesAll(r, filters))
  const counted = (rows: Row[]) => async (f: Record<string, unknown> = {}) => {
    const list = filtered(rows, f)
    return [list, list.length]
  }
  const svc = {
    getOptions: () => resolveOptions({ demo: true }),
    isDemo: () => true,
    listVonHalskyOrders: async (f: Record<string, unknown> = {}) => filtered(orders, f),
    listAndCountVonHalskyOrders: counted(orders),
    listVonHalskyOffers: async (f: Record<string, unknown> = {}) => filtered(offers, f),
    listAndCountVonHalskyOffers: counted(offers),
    listAndCountVonHalskyCases: counted(cases),
    listVonHalskySyncLogs: async () => [{ id: "vhlog_1", created_at: "2026-10-18T10:00:00.000Z" }],
    updateVonHalskyOrders: async (x: unknown) => {
      writes.push(x)
      return x
    },
  }
  return { scope: { resolve: (key: string) => (key === "vonhalsky" ? svc : undefined) } as never, writes }
}

const ORDERS: Row[] = [
  { id: "vhord_1", order_id: "order_1", marketplace_order_id: "mo-1", status: "imported", remote_status: "ACCEPTED", demo: false, delivery_type: "APM", delivery_point: "WAW01M", payment_type: "BLIK_CODE", tracking_status: "linked", tracking_numbers: ["111"], shipped_at: "2026-10-18T12:00:00.000Z", returns_count: 1, claims_count: 0, updated_at: "2026-10-18T10:00:00.000Z" },
  { id: "vhord_2", order_id: "order_2", marketplace_order_id: "mo-2", status: "imported", remote_status: "ACCEPTED", demo: false, delivery_type: "COURIER", delivery_point: null, payment_type: "CASH_ON_DELIVERY", tracking_status: "waiting", tracking_numbers: ["222"], shipped_at: null, updated_at: null },
  { id: "vhord_3", order_id: "order_3", marketplace_order_id: "mo-3", status: "imported", remote_status: "ACCEPTED", demo: true, delivery_type: "APM", delivery_point: "DEMO01M", payment_type: "BLIK_CODE", tracking_status: "none", tracking_numbers: [], shipped_at: null, updated_at: null },
  { id: "vhord_4", order_id: null, marketplace_order_id: "mo-4", status: "held", remote_status: "ACCEPTED", demo: false, delivery_type: null, delivery_point: null, payment_type: null, tracking_status: "none", tracking_numbers: [], shipped_at: null, updated_at: null },
  { id: "vhord_5", order_id: "order_5", marketplace_order_id: "mo-5", status: "imported", remote_status: "CANCELED", demo: false, delivery_type: "APM", delivery_point: "WAW02M", payment_type: "CARD", tracking_status: "none", tracking_numbers: [], shipped_at: null, updated_at: null },
]

const OFFERS: Row[] = [
  { id: "vhoff_1", product_id: "prod_1", status: "listed", reasons: [], demo: false, updated_at: "2026-10-18T10:00:00.000Z" },
  { id: "vhoff_2", product_id: "prod_1", status: "draft", reasons: [], demo: false, updated_at: null },
  { id: "vhoff_3", product_id: "prod_2", status: "blocked", reasons: ["no_gpsr", "no_ean"], demo: false, updated_at: null },
  { id: "vhoff_4", product_id: "prod_3", status: "draft", reasons: [], demo: true, updated_at: null },
]

const CASES: Row[] = [
  { id: "vhcase_1", kind: "return", status: "NEW", sub_status: null },
  { id: "vhcase_2", kind: "return", status: "ACCEPTED", sub_status: null },
  { id: "vhcase_3", kind: "claim", status: "RESOLUTION_IN_PROGRESS", sub_status: null },
  { id: "vhcase_4", kind: "claim", status: "APPROVED", sub_status: null },
  { id: "vhcase_5", kind: "refund", status: "ACCEPTED", sub_status: "DECLINED" },
  { id: "vhcase_6", kind: "refund", status: "ACCEPTED", sub_status: "REFUNDED" },
]

{
  const { scope, writes } = fakeScope(ORDERS, OFFERS, CASES)
  conformance({ routes: vonHalskyIntegration, scope, entity: "order", knownIds: ["order_1", "order_2", "order_3", "order_5", "order_9"], writes: () => writes })
}
{
  const { scope, writes } = fakeScope(ORDERS, OFFERS, CASES)
  conformance({ routes: vonHalskyIntegration, scope, entity: "product", knownIds: ["prod_1", "prod_2", "prod_3", "prod_9"], writes: () => writes })
}

const row = (over: Partial<OrderRow> = {}): OrderRow => ({
  order_id: "order_1",
  marketplace_order_id: "mo-1",
  demo: false,
  delivery_type: "APM",
  delivery_point: "WAW01M",
  payment_type: "BLIK_CODE",
  tracking_status: "none",
  tracking_numbers: [],
  updated_at: null,
  ...over,
})

test("integration: an order that did not come from the marketplace has no line", () => {
  assert.equal(orderSummary(undefined), undefined)
})

test("integration: a shipment InPost does not show yet needs a person", () => {
  const s = orderSummary(row({ tracking_status: "waiting", tracking_numbers: ["111"] }))
  assert.equal(s?.state, "attention")
  assert.deepEqual(s?.title, { key: "integration.order.trackingWaiting" })
})

test("integration: a parcel InPost linked is ok, in demo it says so", () => {
  const live = orderSummary(row({ tracking_status: "linked", tracking_numbers: ["111"] }))
  assert.equal(live?.state, "ok")
  assert.deepEqual(live?.title, { key: "integration.order.trackingLinked" })
  assert.deepEqual(orderSummary(row({ tracking_status: "linked", demo: true }))?.title, { key: "integration.order.trackingDemo" })
})

test("integration: an order to ship is under way, a demo order says it is a demo", () => {
  assert.equal(orderSummary(row())?.state, "active")
  assert.deepEqual(orderSummary(row())?.title, { key: "integration.order.awaiting" })
  assert.equal(orderSummary(row({ demo: true }))?.state, "active")
  assert.deepEqual(orderSummary(row({ demo: true }))?.title, { key: "integration.order.demo" })
})

test("integration: the channel fact names the marketplace, cash on delivery carries the cod code", () => {
  const s = orderSummary(row({ payment_type: "CASH_ON_DELIVERY", tracking_numbers: ["111", "222"] }))!
  const channel = s.facts!.find((f) => f.slot === "channel")!
  assert.equal(channel.code, "vonhalsky")
  assert.equal(s.facts!.find((f) => f.slot === "payment")!.code, "cod")
  assert.equal(orderSummary(row())!.facts!.find((f) => f.slot === "payment")!.code, "paid")
  assert.deepEqual(s.facts!.find((f) => f.slot === "delivery")!.value, { key: "integration.fact.locker", params: { point: "WAW01M" } })
  assert.deepEqual(s.facts!.find((f) => f.slot === "delivery" && f.priority === 25)!.value, { key: "integration.fact.tracking", params: { numbers: "111, 222" } })
  assert.deepEqual(s.links, [{ kind: "admin", href: "/vonhalsky?section=orders&q=mo-1" }])
})

test("integration: returns and claims of an order show as an after sale fact", () => {
  const s = orderSummary(row({ returns_count: 1, claims_count: 2 }))!
  assert.deepEqual(s.facts!.find((f) => f.code === "after_sale")?.value, { key: "integration.fact.afterSale", params: { returns: 1, claims: 2 } })
  assert.equal(orderSummary(row())!.facts!.some((f) => f.code === "after_sale"), false)
})

test("integration: a blocked variant makes the product wait, with its first reason", () => {
  const blocked = productSummary("prod_2", [{ product_id: "prod_2", status: "blocked", reasons: ["no_gpsr"], demo: false, updated_at: null }])!
  assert.equal(blocked.state, "attention")
  assert.deepEqual(blocked.detail, { key: "integration.reason.no_gpsr" })
  const listed = productSummary("prod_1", [
    { product_id: "prod_1", status: "listed", reasons: [], demo: false, updated_at: null },
    { product_id: "prod_1", status: "draft", reasons: [], demo: false, updated_at: null },
  ])!
  assert.equal(listed.state, "ok")
  assert.deepEqual(listed.counts, { listed: 1, blocked: 0, draft: 1 })
  assert.equal(productSummary("prod_9", []), undefined)
})

test("integration: the counters link to the filters of the page", () => {
  const c = vonHalskyCounters({ held: 1, trackingWaiting: 2, openCases: 5, blockedOffers: 3, awaitingShipment: 4 })
  assert.deepEqual(
    c.map((x) => [x.key, x.scope, x.count, x.tone, x.link.href]),
    [
      ["held_orders", "orders", 1, "red", "/vonhalsky?section=orders&filter=held"],
      ["tracking_waiting", "orders", 2, "orange", "/vonhalsky?section=orders&filter=tracking_waiting"],
      ["open_cases", "orders", 5, "orange", "/vonhalsky?section=after-sale"],
      ["awaiting_shipment", "orders", 4, "blue", "/vonhalsky?section=orders&filter=awaiting_shipment"],
      ["blocked_offers", "products", 3, "orange", "/vonhalsky?section=offers&filter=blocked"],
    ],
  )
})

test("integration: the board counts held imports, waiting shipments, open cases, orders to ship and blocked offers", async () => {
  const { scope, writes } = fakeScope(ORDERS, OFFERS, CASES)
  const a = await vonHalskyIntegration.build.attention(makeContext({ scope, lang: "en" }), ["orders", "products"])
  const counts = Object.fromEntries(a.items.map((i) => [i.key, i.count]))
  assert.deepEqual(counts, {
    held_orders: 1,
    tracking_waiting: 1,
    open_cases: 3,
    awaiting_shipment: 2,
    blocked_offers: 1,
  })
  assert.deepEqual(writes, [])
})

test("integration: a cancelled or shipped order is never counted as one to ship", async () => {
  const shippedOrCancelled = ORDERS.filter((o) => o.id === "vhord_1" || o.id === "vhord_5")
  const { scope } = fakeScope(shippedOrCancelled, [], [])
  const a = await vonHalskyIntegration.build.attention(makeContext({ scope, lang: "en" }), ["orders"])
  assert.equal(a.items.find((i) => i.key === "awaiting_shipment")?.count, 0)
})
