/**
 * InPost Pay in the koda.integration/1 contract: the shared conformance
 * checks with a fake scope, then the plugin's own promises: an order
 * without a basket has no line, a failed payment reads failed, a paid one
 * ok, cash on delivery carries the cod code, the counters link to filters.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { inpostPayIntegration } from "../src/workflows/inpostpay/integration.ts"
import { inpostPayCounters, orderSummary } from "../src/modules/inpostpay/lib/integration.ts"
import { resolveOptions } from "../src/modules/inpostpay/lib/options.ts"
import { conformance } from "./kit-conformance.ts"

type Row = Record<string, unknown>

function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined || filter === null) return true
  if (Array.isArray(filter)) return filter.includes(value)
  return value === filter
}

function fakeScope(rows: Row[]) {
  const writes: unknown[] = []
  const filtered = (filters: Record<string, unknown> = {}) => rows.filter((r) => Object.entries(filters).every(([k, v]) => matches(r[k], v)))
  const svc = {
    getOptions: () => resolveOptions({ demo: true }),
    isDemo: () => true,
    listInpostPayBaskets: async (filters: Record<string, unknown> = {}) => filtered(filters),
    listAndCountInpostPayBaskets: async (filters: Record<string, unknown> = {}) => {
      const list = filtered(filters)
      return [list, list.length]
    },
    updateInpostPayBaskets: async (x: unknown) => {
      writes.push(x)
      return x
    },
  }
  return { scope: { resolve: (key: string) => (key === "inpostpay" ? svc : undefined) } as never, writes }
}

const ROWS = [
  { id: "ipbsk_1", order_id: "order_1", demo: false, status: "ordered", payment_status: "AUTHORIZED", order_status: "ORDER_PROCESSING", delivery_type: "APM", delivery_point: "KRA01M", masked_phone: "60*****00", updated_at: "2026-10-18T10:00:00.000Z" },
  { id: "ipbsk_2", order_id: "order_2", demo: false, status: "ordered", payment_status: "DECLINED", order_status: "ORDER_PROCESSING", delivery_type: "COURIER", delivery_point: null, masked_phone: null, updated_at: "2026-10-18T10:00:00.000Z" },
  { id: "ipbsk_3", order_id: "order_3", demo: false, status: "ordered", payment_status: "COD", order_status: null, delivery_type: "COURIER", delivery_point: null, masked_phone: "61*****11", updated_at: null },
  { id: "ipbsk_4", order_id: null, demo: false, status: "failed", payment_status: null, order_status: null, delivery_type: null, delivery_point: null, masked_phone: null, updated_at: null },
]

{
  const { scope, writes } = fakeScope(ROWS)
  conformance({ routes: inpostPayIntegration, scope, entity: "order", knownIds: ["order_1", "order_2", "order_3", "order_9"], writes: () => writes })
}

const row = (over: Partial<Parameters<typeof orderSummary>[0] & object> = {}) => ({
  order_id: "order_1",
  demo: false,
  status: "ordered",
  payment_status: "AUTHORIZED",
  order_status: "ORDER_PROCESSING",
  delivery_type: "APM",
  delivery_point: "KRA01M",
  masked_phone: "60*****00",
  updated_at: null,
  ...over,
})

test("integration: an order without a basket has no line", () => {
  assert.equal(orderSummary(undefined), undefined)
})

test("integration: paid is ok, a declined payment and a rejected order are failed", () => {
  assert.equal(orderSummary(row())?.state, "ok")
  assert.deepEqual(orderSummary(row())?.title, { key: "integration.order.paid" })
  assert.equal(orderSummary(row({ payment_status: "DECLINED" }))?.state, "failed")
  assert.equal(orderSummary(row({ order_status: "ORDER_REJECTED" }))?.state, "failed")
  assert.equal(orderSummary(row({ payment_status: "PENDING" }))?.state, "active")
  assert.equal(orderSummary(row({ demo: true, payment_status: "PENDING" }))?.state, "ok")
})

test("integration: cash on delivery carries the cod code, the locker is a delivery fact", () => {
  const s = orderSummary(row({ payment_status: "COD" }))!
  assert.equal(s.state, "ok")
  const payment = s.facts!.find((f) => f.slot === "payment")!
  assert.equal(payment.code, "cod")
  assert.deepEqual(payment.sub, { key: "integration.fact.phone", params: { phone: "60*****00" } })
  assert.deepEqual(s.facts!.find((f) => f.slot === "delivery")?.value, { key: "integration.fact.locker", params: { point: "KRA01M" } })
  assert.deepEqual(s.links, [{ kind: "admin", href: "/inpostpay?q=order_1" }])
})

test("integration: the counters link to the filters of the page", () => {
  const c = inpostPayCounters({ paymentProblems: 2, failedBaskets: 1 })
  assert.deepEqual(
    c.map((x) => [x.key, x.count, x.tone, x.link.href]),
    [
      ["payment_problems", 2, "red", "/inpostpay?filter=payment_problems"],
      ["failed_baskets", 1, "orange", "/inpostpay?filter=failed"],
    ],
  )
})
