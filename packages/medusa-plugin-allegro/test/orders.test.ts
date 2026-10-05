import { test } from "node:test"
import assert from "node:assert/strict"
import { linkLines, orderFromApi, orderGroup } from "../src/modules/allegro/lib/orders.ts"

const form = {
  id: "0f8b4c56-7e1a-4c3e-9a51-0123456789ab",
  status: "READY_FOR_PROCESSING",
  buyer: { email: "jan@example.com", login: "jan", firstName: "Jan", phoneNumber: "+48 600 000 000" },
  delivery: { method: { name: "Allegro Paczkomaty InPost" }, address: { street: "Długa 1" } },
  payment: { id: "p1", type: "ONLINE", paidAmount: { amount: "152.98", currency: "PLN" } },
  fulfillment: { status: "PROCESSING" },
  marketplace: { id: "allegro-pl" },
  summary: { totalToPay: { amount: "152.98", currency: "PLN" } },
  lineItems: [
    {
      id: "li1",
      offer: { id: "17000000001", name: "Wkrętarka", external: { id: "KS-WK-18V" } },
      quantity: 1,
      price: { amount: "139.99", currency: "PLN" },
      boughtAt: "2026-10-04T09:15:00.000Z",
    },
    {
      id: "li2",
      offer: { id: "17000000002", name: "Bity", external: null },
      quantity: 2,
      price: { amount: "6.50", currency: "PLN" },
      boughtAt: "2026-10-04T09:14:00.000Z",
    },
  ],
  updatedAt: "2026-10-04T11:00:00.000Z",
}

test("orders: the journal keeps lines, statuses and totals, and NO buyer data", () => {
  const o = orderFromApi(form)
  assert.ok(o)
  assert.equal(o.fulfillmentStatus, "PROCESSING")
  assert.deepEqual(o.total, { value: 152.98, currency: "PLN" })
  assert.equal(o.boughtAt, "2026-10-04T09:14:00.000Z")
  assert.equal(o.deliveryMethod, "Allegro Paczkomaty InPost")
  assert.equal(o.lines.length, 2)
  assert.equal(o.lines[1].quantity, 2)
  const text = JSON.stringify(o)
  for (const personal of ["jan@example.com", "Jan", "600 000 000", "Długa"]) {
    assert.ok(!text.includes(personal), `${personal} must not be stored`)
  }
})

test("orders: lines link by offer id first, then by signature", () => {
  const o = orderFromApi(form)
  assert.ok(o)
  const v1 = { id: "v1", productId: "p1", sku: "KS-WK-18V", productTitle: "Wkrętarka" }
  const v2 = { id: "v2", productId: "p2", sku: "KS-BIT", productTitle: "Bity" }
  const byOffer = new Map([["17000000002", v2]])
  const bySku = new Map([["KS-WK-18V", v1]])
  const linked = linkLines(o.lines, byOffer, bySku)
  assert.equal(linked.unmatched, 0)
  assert.equal(linked.lines[0].variantId, "v1")
  assert.equal(linked.lines[1].variantId, "v2")
  const none = linkLines(o.lines, new Map(), new Map())
  assert.equal(none.unmatched, 2)
})

test("orders: groups for the filters", () => {
  assert.equal(orderGroup("READY_FOR_PROCESSING", "NEW"), "open")
  assert.equal(orderGroup("BOUGHT", null), "open")
  assert.equal(orderGroup("READY_FOR_PROCESSING", "SENT"), "sent")
  assert.equal(orderGroup("READY_FOR_PROCESSING", "PICKED_UP"), "sent")
  assert.equal(orderGroup("CANCELLED", "NEW"), "cancelled")
  assert.equal(orderGroup("READY_FOR_PROCESSING", "RETURNED"), "cancelled")
  assert.equal(orderFromApi({ status: "BOUGHT" }), null)
})

test("orders: a json column read back with reordered keys is not a change", async () => {
  const { sameJson } = await import("../src/modules/allegro/lib/dto.ts")
  const fresh = [{ offerId: "1", offerName: "A", externalId: null, quantity: 1, price: { value: 9.99, currency: "PLN" }, variantId: "v", productId: "p", sku: "S", productTitle: "T" }]
  const stored = [{ sku: "S", price: { currency: "PLN", value: 9.99 }, offerId: "1", quantity: 1, offerName: "A", productId: "p", variantId: "v", externalId: null, productTitle: "T" }]
  assert.equal(sameJson(stored, fresh), true)
  assert.equal(sameJson(stored, [{ ...fresh[0], quantity: 2 }]), false)
  assert.equal(sameJson(null, undefined), true)
})
