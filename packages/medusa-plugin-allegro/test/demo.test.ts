import { test } from "node:test"
import assert from "node:assert/strict"
import { buildDemoRawOffers, buildDemoRawOrders, demoUuid } from "../src/modules/allegro/lib/demo.ts"
import { offersFromApi } from "../src/modules/allegro/lib/offers.ts"
import { matchOffers } from "../src/modules/allegro/lib/matching.ts"
import { ordersFromApi } from "../src/modules/allegro/lib/orders.ts"
import { stockState } from "../src/modules/allegro/lib/stock.ts"

const day = new Date("2026-10-05T00:00:00.000Z")
const catalog = Array.from({ length: 14 }, (_, i) => ({
  sku: `KS-T-${String(i).padStart(2, "0")}`,
  productTitle: `Narzędzie ${i}`,
  price: { value: 100 + i, currency: "PLN" },
  available: 4,
}))

test("demo offers: deterministic, shaped like the API, every scenario present", () => {
  const a = buildDemoRawOffers(catalog, day)
  const b = buildDemoRawOffers([...catalog].reverse(), day)
  assert.deepEqual(a, b)

  const { offers } = offersFromApi(a)
  const variants = catalog.map((c, i) => ({ id: `v${i}`, sku: c.sku, productId: `p${i}`, productTitle: c.productTitle }))
  const { matches, summary } = matchOffers(offers, variants)
  assert.ok(summary.unmatchedLive >= 2, "live offers without a product")
  assert.equal(summary.noKey, 1)

  const states = offers
    .filter((o) => matches.get(o.allegroId)?.isPrimary)
    .map((o) => stockState({ status: o.status, allegro: o.available, medusa: 4 }))
  assert.ok(states.includes("oversell"))
  assert.ok(states.includes("under_listed"))
  assert.ok(states.includes("ended_in_stock"))
  assert.ok(states.includes("ok"))
})

test("demo orders: built from the demo offers, no buyer data, stable ids within a day", () => {
  const raw = buildDemoRawOffers(catalog, day)
  const orders = ordersFromApi(buildDemoRawOrders(raw, day))
  assert.equal(orders.length, 8)
  assert.deepEqual(
    ordersFromApi(buildDemoRawOrders(raw, day)).map((o) => o.allegroId),
    orders.map((o) => o.allegroId),
  )
  assert.ok(orders.some((o) => o.status === "CANCELLED"))
  assert.ok(orders.some((o) => o.fulfillmentStatus === "SENT"))
  assert.ok(!JSON.stringify(buildDemoRawOrders(raw, day)).includes("buyer"))
})

test("demo uuid looks like a checkout form id", () => {
  assert.match(demoUuid("x"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(demoUuid("x"), demoUuid("x"))
  assert.notEqual(demoUuid("x"), demoUuid("y"))
})
