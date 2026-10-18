/**
 * InPost Von Halsky in the koda.integration/1 contract: the shared
 * conformance checks with a fake scope (orders and products), then the
 * plugin's own promises: an order that did not come from the marketplace
 * has no line, failed tracking reads failed, sent reads ok, a blocked
 * variant makes the product wait for a person, the counters link to the
 * filters of the page.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { vonHalskyIntegration } from "../src/workflows/vonhalsky/integration.ts"
import { orderSummary, productSummary, vonHalskyCounters } from "../src/modules/vonhalsky/lib/integration.ts"
import { resolveOptions } from "../src/modules/vonhalsky/lib/options.ts"
import { conformance } from "./kit-conformance.ts"

type Row = Record<string, unknown>

function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined || filter === null) return true
  if (Array.isArray(filter)) return filter.includes(value)
  return value === filter
}

function fakeScope(orders: Row[], offers: Row[]) {
  const writes: unknown[] = []
  const filtered = (rows: Row[], filters: Record<string, unknown> = {}) => rows.filter((r) => Object.entries(filters).every(([k, v]) => matches(r[k], v)))
  const svc = {
    getOptions: () => resolveOptions({ demo: true }),
    isDemo: () => true,
    listVonHalskyOrders: async (f: Record<string, unknown> = {}) => filtered(orders, f),
    listAndCountVonHalskyOrders: async (f: Record<string, unknown> = {}) => {
      const list = filtered(orders, f)
      return [list, list.length]
    },
    listVonHalskyOffers: async (f: Record<string, unknown> = {}) => filtered(offers, f),
    listAndCountVonHalskyOffers: async (f: Record<string, unknown> = {}) => {
      const list = filtered(offers, f)
      return [list, list.length]
    },
    listVonHalskySyncLogs: async () => [{ id: "vhlog_1", created_at: "2026-10-18T10:00:00.000Z" }],
    updateVonHalskyOrders: async (x: unknown) => {
      writes.push(x)
      return x
    },
  }
  return { scope: { resolve: (key: string) => (key === "vonhalsky" ? svc : undefined) } as never, writes }
}

const ORDERS = [
  { id: "vhord_1", order_id: "order_1", marketplace_order_id: "mo-1", status: "imported", demo: false, delivery_type: "APM", delivery_point: "WAW01M", payment_type: "BLIK_CODE", tracking_status: "sent", tracking_numbers: ["111"], updated_at: "2026-10-18T10:00:00.000Z" },
  { id: "vhord_2", order_id: "order_2", marketplace_order_id: "mo-2", status: "imported", demo: false, delivery_type: "COURIER", delivery_point: null, payment_type: "CASH_ON_DELIVERY", tracking_status: "failed", tracking_numbers: [], updated_at: null },
  { id: "vhord_3", order_id: "order_3", marketplace_order_id: "mo-3", status: "imported", demo: true, delivery_type: "APM", delivery_point: "DEMO01M", payment_type: "BLIK_CODE", tracking_status: "none", tracking_numbers: [], updated_at: null },
  { id: "vhord_4", order_id: null, marketplace_order_id: "mo-4", status: "held", demo: false, delivery_type: null, delivery_point: null, payment_type: null, tracking_status: "none", tracking_numbers: [], updated_at: null },
]

const OFFERS = [
  { id: "vhoff_1", product_id: "prod_1", status: "listed", reasons: [], demo: false, updated_at: "2026-10-18T10:00:00.000Z" },
  { id: "vhoff_2", product_id: "prod_1", status: "draft", reasons: [], demo: false, updated_at: null },
  { id: "vhoff_3", product_id: "prod_2", status: "blocked", reasons: ["no_gpsr", "no_ean"], demo: false, updated_at: null },
  { id: "vhoff_4", product_id: "prod_3", status: "draft", reasons: [], demo: true, updated_at: null },
]

{
  const { scope, writes } = fakeScope(ORDERS, OFFERS)
  conformance({ routes: vonHalskyIntegration, scope, entity: "order", knownIds: ["order_1", "order_2", "order_3", "order_9"], writes: () => writes })
}
{
  const { scope, writes } = fakeScope(ORDERS, OFFERS)
  conformance({ routes: vonHalskyIntegration, scope, entity: "product", knownIds: ["prod_1", "prod_2", "prod_3", "prod_9"], writes: () => writes })
}

const row = (over: Partial<Parameters<typeof orderSummary>[0] & object> = {}) => ({
  order_id: "order_1",
  marketplace_order_id: "mo-1",
  demo: false,
  delivery_type: "APM",
  delivery_point: "WAW01M",
  payment_type: "BLIK_CODE",
  tracking_status: "none",
  tracking_numbers: [] as string[],
  updated_at: null,
  ...over,
})

test("integration: an order that did not come from the marketplace has no line", () => {
  assert.equal(orderSummary(undefined), undefined)
})

test("integration: tracking sent is ok, failed is failed, waiting for the API needs a person, to ship is under way", () => {
  assert.equal(orderSummary(row({ tracking_status: "sent", tracking_numbers: ["111"] }))?.state, "ok")
  assert.deepEqual(orderSummary(row({ tracking_status: "sent", demo: true }))?.title, { key: "integration.order.trackingRecorded" })
  assert.equal(orderSummary(row({ tracking_status: "failed" }))?.state, "failed")
  assert.equal(orderSummary(row({ tracking_status: "pending_api" }))?.state, "attention")
  assert.equal(orderSummary(row())?.state, "active")
  assert.deepEqual(orderSummary(row())?.title, { key: "integration.order.awaiting" })
})

test("integration: the channel fact names the marketplace, cash on delivery carries the cod code", () => {
  const s = orderSummary(row({ payment_type: "CASH_ON_DELIVERY", tracking_numbers: ["111", "222"] }))!
  const channel = s.facts!.find((f) => f.slot === "channel")!
  assert.equal(channel.code, "vonhalsky")
  assert.equal(s.facts!.find((f) => f.slot === "payment")!.code, "cod")
  assert.deepEqual(s.facts!.find((f) => f.slot === "delivery")!.value, { key: "integration.fact.locker", params: { point: "WAW01M" } })
  assert.deepEqual(s.links, [{ kind: "admin", href: "/vonhalsky?section=orders&q=mo-1" }])
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
  const c = vonHalskyCounters({ held: 1, trackingFailed: 2, blockedOffers: 3, awaitingShipment: 4 })
  assert.deepEqual(
    c.map((x) => [x.key, x.scope, x.count, x.tone, x.link.href]),
    [
      ["held_orders", "orders", 1, "red", "/vonhalsky?section=orders&filter=held"],
      ["tracking_failed", "orders", 2, "red", "/vonhalsky?section=orders&filter=errors"],
      ["awaiting_shipment", "orders", 4, "blue", "/vonhalsky?section=orders&filter=awaiting_shipment"],
      ["blocked_offers", "products", 3, "orange", "/vonhalsky?section=offers&filter=blocked"],
    ],
  )
})
