/**
 * Coupons in the koda.integration/1 contract: the shared conformance checks
 * with a fake scope (Query and the database answer from memory), then what
 * the plugin itself promises: an order without a coupon has no line, one
 * coupon names its code and amount, the counters link to filtered lists.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { couponsIntegration } from "../src/workflows/coupons/integration.ts"
import { couponsCounters, orderSummary, productSummary } from "../src/modules/coupons/lib/integration.ts"
import { conformance } from "./kit-conformance.ts"

const ADJUSTMENTS: Record<string, Array<{ code: string | null; promotion_id: string; part: string; discount: number; currency_code: string }>> = {
  order_1: [{ code: "JESIEN15", promotion_id: "promo_1", part: "items", discount: 45, currency_code: "pln" }],
  order_2: [
    { code: "JESIEN15", promotion_id: "promo_1", part: "items", discount: 30, currency_code: "pln" },
    { code: "DOSTAWA0", promotion_id: "promo_2", part: "shipping", discount: 14.99, currency_code: "pln" },
  ],
}

function fakeScope() {
  const svc = { getOptions: () => ({ currencyCode: "pln", memberGroupIds: [], codePrefix: null, problems: [] }), getLogger: () => console }
  const sql = {
    raw: async (text: string, bindings: unknown[] = []) => {
      if (text.includes("o.id = ?")) return { rows: ADJUSTMENTS[String(bindings[0])] ?? [] }
      return { rows: [] }
    },
  }
  const query = { graph: async () => ({ data: [] }) }
  const registry: Record<string, unknown> = { koda_coupons: svc, __pg_connection__: sql, query }
  return { resolve: (key: string) => registry[key] } as never
}

conformance({ routes: couponsIntegration, scope: fakeScope(), entity: "order", knownIds: ["order_1", "order_2", "order_3"], writes: () => [] })

const money = (n: number) => `${n.toFixed(2)} zł`

test("integration: an order without a coupon has no line", () => {
  assert.equal(orderSummary("order_3", [], money), undefined)
})

test("integration: one coupon names its code and amount, two give the count and the sum", () => {
  const one = orderSummary("order_1", [{ code: "JESIEN15", discount: 45 }], money)
  assert.deepEqual(one?.title, { key: "integration.order.one", params: { code: "JESIEN15", amount: "45.00 zł" } })
  const two = orderSummary("order_2", [{ code: "JESIEN15", discount: 30 }, { code: "DOSTAWA0", discount: 14.99 }], money)
  assert.deepEqual(two?.title, { key: "integration.order.many", params: { count: 2, amount: "44.99 zł" } })
})

test("integration: a product line only with active coupons, counters link to filtered lists", () => {
  assert.equal(productSummary("prod_1", 0), undefined)
  assert.equal(productSummary("prod_1", 2)?.state, "active")
  const c = couponsCounters({ expiring: 1, automaticForEveryone: 2 })
  assert.deepEqual(c.map((x) => [x.key, x.count, x.link.href]), [
    ["expiring", 1, "/coupons?status=expiring"],
    ["automatic_everyone", 2, "/coupons?status=automatic"],
  ])
})
