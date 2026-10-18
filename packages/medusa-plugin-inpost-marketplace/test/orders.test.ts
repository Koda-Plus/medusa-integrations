/**
 * Marketplace orders into Medusa, the pure parts: reading an order in the
 * shape of the public SDK's `Order` (camelCase on the wire, snake_case
 * accepted), the decision (create or hold, never an invented product), the
 * Medusa order it makes, and what an existing row means for a second
 * import (idempotency by the marketplace order id).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { IMPORT_LEASE_MS, importAction, matchLine, parseMarketplaceOrder, planImport, type ImportContext } from "../src/modules/vonhalsky/lib/orders.ts"

const WIRE = {
  id: "8c4c2f2e-0000-4000-8000-000000000001",
  organizationId: "org-1",
  createdAt: "2026-10-18T10:00:00Z",
  status: "CREATED",
  customer: { email: "buyer@example.com", firstName: "Jan", lastName: "Testowy", phoneNumber: "+48500000000", address: { street: "Przykładowa", building: "1", flat: "2", city: "Warszawa", postCode: "00-001", countryCode: "pl" } },
  delivery: { deliveryType: "APM", deliveryPoint: "WAW01M", parcels: [], price: { amount: 9.99, currency: "PLN" }, phoneNumber: "+48500000001" },
  orderLines: [
    { offer: { offerId: "off-1", externalId: "variant_1", product: { productId: "p1", name: "Mug", sku: "SKU-1" }, price: { amount: 49.99, currency: "PLN" } } },
    { offer: { offerId: "off-2", product: { productId: "p2", name: "Plate", sku: "sku-2" }, price: { amount: 20, currency: "PLN" } }, quantity: 2 },
  ],
  finalPrice: { amount: 99.98, currency: "PLN" },
  paymentDetails: { selectedPaymentType: "BLIK_CODE", payments: [] },
}

const CTX: ImportContext = {
  regionId: "reg_1",
  currency: "pln",
  salesChannelId: "sc_1",
  shippingOptionId: "so_apm",
  offers: [
    { remoteId: "off-1", variantId: "variant_1", sku: "SKU-1", title: "Ceramic mug" },
    { remoteId: null, variantId: "variant_2", sku: "SKU-2", title: "Plate" },
  ],
  demo: false,
}

test("parse: the wire format of the SDK models, and snake_case too", () => {
  const o = parseMarketplaceOrder(WIRE)
  assert.equal(o.id, WIRE.id)
  assert.equal(o.status, "CREATED")
  assert.equal(o.currency, "PLN")
  assert.equal(o.totalMinor, 9998)
  assert.equal(o.delivery.type, "APM")
  assert.equal(o.delivery.point, "WAW01M")
  assert.equal(o.delivery.priceMinor, 999)
  assert.equal(o.buyer.address?.countryCode, "PL")
  assert.equal(o.lines.length, 2)
  assert.deepEqual(o.lines[0], { offerId: "off-1", externalId: "variant_1", sku: "SKU-1", ean: null, name: "Mug", quantity: 1, unitPriceMinor: 4999 })
  assert.equal(o.lines[1].quantity, 2)
  assert.equal(o.paymentType, "BLIK_CODE")
  assert.equal(o.paid, true)
  const snake = parseMarketplaceOrder({ id: "x", status: "created", order_lines: [{ offer: { offer_id: "off-1", price: { amount: 1, currency: "PLN" } } }], final_price: { amount: 1, currency: "PLN" }, payment_details: { selected_payment_type: "CASH_ON_DELIVERY" } })
  assert.equal(snake.lines[0].offerId, "off-1")
  assert.equal(snake.paid, false)
  const empty = parseMarketplaceOrder(null)
  assert.equal(empty.id, "")
  assert.equal(empty.delivery.type, "UNKNOWN")
})

test("plan: a matched order becomes a draft Medusa order, paid, gross prices, the locker on the address", () => {
  const d = planImport(parseMarketplaceOrder(WIRE), CTX)
  assert.equal(d.kind, "create")
  if (d.kind !== "create") return
  assert.equal(d.order.status, "draft")
  assert.equal(d.order.no_notification, true)
  assert.equal(d.order.sales_channel_id, "sc_1")
  assert.equal(d.order.currency_code, "pln")
  assert.deepEqual(
    d.order.items.map((i) => [i.variant_id, i.quantity, i.unit_price, i.is_tax_inclusive]),
    [
      ["variant_1", 1, 49.99, true],
      ["variant_2", 2, 20, true],
    ],
  )
  assert.equal(d.order.items[0].title, "Ceramic mug")
  assert.equal(d.order.shipping_methods[0].amount, 9.99)
  assert.equal(d.order.shipping_methods[0].shipping_option_id, "so_apm")
  assert.equal(d.order.shipping_address.address_1, "Przykładowa 1/2")
  assert.equal(d.order.shipping_address.address_2, "Paczkomat WAW01M")
  assert.equal(d.order.shipping_address.country_code, "pl")
  assert.equal(d.order.shipping_address.phone, "+48500000001")
  assert.equal(d.order.metadata.marketplace_order_ref, `vonhalsky:${WIRE.id}`)
  assert.equal(d.order.metadata.koda_demo, undefined)
  assert.equal(d.email, "buyer@example.com")
  assert.equal(d.paid, true)
  assert.equal(d.lines[1].unit_price_minor, 2000)
  const demo = planImport(parseMarketplaceOrder(WIRE), { ...CTX, demo: true, shippingOptionId: null })
  assert.equal(demo.kind === "create" && demo.order.metadata.koda_demo, true)
  assert.equal(demo.kind === "create" && "shipping_option_id" in demo.order.shipping_methods[0], false)
})

test("plan: lines are matched by offer id, then external id, then SKU", () => {
  const line = parseMarketplaceOrder(WIRE).lines[0]
  assert.equal(matchLine(line, CTX.offers)?.variantId, "variant_1")
  assert.equal(matchLine({ ...line, offerId: "zzz" }, CTX.offers)?.variantId, "variant_1")
  assert.equal(matchLine({ ...line, offerId: "zzz", externalId: null, sku: "sku-2" }, CTX.offers)?.variantId, "variant_2")
  assert.equal(matchLine({ ...line, offerId: "zzz", externalId: null, sku: null }, CTX.offers), null)
})

test("plan: never an invented product, and every hold says why", () => {
  const raw = parseMarketplaceOrder(WIRE)
  const hold = (o: ReturnType<typeof parseMarketplaceOrder>, ctx: ImportContext = CTX) => {
    const d = planImport(o, ctx)
    return d.kind === "hold" ? d.code : d.kind
  }
  assert.equal(hold({ ...raw, lines: [{ ...raw.lines[0], offerId: "unknown", externalId: null, sku: "NOPE" }] }), "unmapped_lines")
  assert.equal(hold({ ...raw, id: "" }), "no_id")
  assert.equal(hold({ ...raw, status: "CANCELED" }), "cancelled")
  assert.equal(hold({ ...raw, lines: [] }), "no_lines")
  assert.equal(hold({ ...raw, lines: [{ ...raw.lines[0], quantity: 0 }] }), "bad_line")
  assert.equal(hold(raw, { ...CTX, regionId: null }), "no_region")
  assert.equal(hold(raw, { ...CTX, salesChannelId: null }), "no_channel")
  assert.equal(hold({ ...raw, currency: "EUR" }), "currency_mismatch")
  assert.equal(hold({ ...raw, delivery: { ...raw.delivery, address: null }, buyer: { ...raw.buyer, address: null } }), "no_address")
})

test("idempotency: an imported order is never created again, a draft is finished, a live attempt is left alone", () => {
  const now = new Date("2026-10-18T12:00:00Z")
  assert.deepEqual(importAction(null, now), { kind: "create" })
  assert.deepEqual(importAction({ status: "imported", order_id: "order_1" }, now), { kind: "already", orderId: "order_1" })
  assert.deepEqual(importAction({ status: "held", order_id: "order_1" }, now), { kind: "finish", orderId: "order_1" })
  assert.deepEqual(importAction({ status: "importing", order_id: "order_1" }, now), { kind: "finish", orderId: "order_1" })
  assert.deepEqual(importAction({ status: "held", order_id: null }, now), { kind: "retry" })
  assert.deepEqual(importAction({ status: "importing", order_id: null, updated_at: new Date(now.getTime() - 1000) }, now), { kind: "busy" })
  assert.deepEqual(importAction({ status: "importing", order_id: null, updated_at: new Date(now.getTime() - IMPORT_LEASE_MS - 1) }, now), { kind: "retry" })
})
