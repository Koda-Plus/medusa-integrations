/**
 * Marketplace orders into Medusa, the pure parts: reading an order in the
 * shape of the seller API's `Order` as the wire really sends it (one line
 * per piece added up per offer and price, the buyer's price from
 * `finalPrice`, a phone as `{ countryPrefix, number }`, paid only when a
 * payment is booked and it is not cash on delivery, InPost's per order
 * delivery e-mail and parcels; snake_case accepted), the facts a row keeps
 * (no personal data), the decision (create or hold, never an invented
 * product, unpaid orders wait, then orders the marketplace has not
 * accepted yet), the Medusa order it makes, and what an
 * existing row means for a second import (idempotency by the marketplace
 * order id).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { addUpLines, IMPORT_LEASE_MS, importAction, matchLine, orderFacts, parseMarketplaceOrder, phoneOf, planImport, type ImportContext } from "../src/modules/vonhalsky/lib/orders.ts"
import type { MarketplaceOrderLine } from "../src/modules/vonhalsky/lib/client.ts"

const PAID_AT = "2026-10-18T10:01:00.000Z"

const WIRE = {
  id: "8c4c2f2e-0000-4000-8000-000000000001",
  organizationId: "org-1",
  createdAt: "2026-10-18T10:00:00Z",
  updatedAt: "2026-10-18T10:05:00Z",
  status: "ACCEPTED",
  customer: { email: "buyer@example.com", firstName: "Jan", lastName: "Testowy", phoneNumber: { countryPrefix: "48", number: "500 000 000" }, address: { street: "Przykładowa", building: "1", flat: "2", city: "Warszawa", postCode: "00-001", countryCode: "pl" } },
  delivery: {
    deliveryType: "APM",
    deliveryPoint: "WAW01M",
    email: "order-1@example.org",
    expectedDeliveryDate: "2026-10-20T12:00:00Z",
    parcels: [{ trackingNumber: "990000000000000000000001", createdAt: "2026-10-19T08:00:00Z", status: "SENT" }],
    price: { amount: 9.99, currency: "PLN" },
    phoneNumber: "+48500000001",
  },
  orderLines: [
    { offer: { offerId: "off-1", externalId: "variant_1", product: { productId: "p1", name: "Mug", sku: "SKU-1" }, price: { amount: 59.99, currency: "PLN" }, finalPrice: { amount: 49.99, currency: "PLN" }, basePrice: { amount: 59.99, currency: "PLN" }, promotionPrice: { amount: 49.99, currency: "PLN" } } },
    { offer: { offerId: "off-2", product: { productId: "p2", name: "Plate", sku: "sku-2" }, price: { amount: 20, currency: "PLN" }, finalPrice: { amount: 20, currency: "PLN" }, basePrice: { amount: 20, currency: "PLN" } } },
    { offer: { offerId: "off-2", product: { productId: "p2", name: "Plate", sku: "sku-2" }, price: { amount: 20, currency: "PLN" }, finalPrice: { amount: 20, currency: "PLN" }, basePrice: { amount: 20, currency: "PLN" } } },
  ],
  finalPrice: { amount: 99.98, currency: "PLN" },
  paymentDetails: { selectedPaymentType: "BLIK_CODE", payments: [{ paymentId: "pay-2", paymentType: "BLIK_CODE", paymentDate: "2026-10-18T11:00:00Z" }, { paymentId: "pay-1", paymentType: "BLIK_CODE", paymentDate: PAID_AT }] },
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

const line = (over: Partial<MarketplaceOrderLine> = {}): MarketplaceOrderLine => ({
  offerId: "off-1",
  externalId: "variant_1",
  sku: "SKU-1",
  ean: null,
  name: "Mug",
  quantity: 1,
  unitPriceMinor: 4999,
  basePriceMinor: null,
  promotionPriceMinor: null,
  programDiscountMinor: null,
  ...over,
})

test("parse: the order, its delivery and its money in minor units", () => {
  const o = parseMarketplaceOrder(WIRE)
  assert.equal(o.id, WIRE.id)
  assert.equal(o.status, "ACCEPTED")
  assert.equal(o.currency, "PLN")
  assert.equal(o.totalMinor, 9998)
  assert.equal(o.delivery.type, "APM")
  assert.equal(o.delivery.point, "WAW01M")
  assert.equal(o.delivery.priceMinor, 999)
  assert.equal(o.delivery.email, "order-1@example.org")
  assert.equal(o.delivery.expectedAt, "2026-10-20T12:00:00.000Z")
  assert.deepEqual(o.delivery.parcels, [{ trackingNumber: "990000000000000000000001", createdAt: "2026-10-19T08:00:00.000Z", status: "SENT" }])
  assert.equal(o.buyer.address?.countryCode, "PL")
  assert.equal(o.paymentType, "BLIK_CODE")
})

test("parse: the buyer pays the final price of a line, its regular and promotion prices are kept", () => {
  const o = parseMarketplaceOrder(WIRE)
  assert.deepEqual(o.lines[0], { offerId: "off-1", externalId: "variant_1", sku: "SKU-1", ean: null, name: "Mug", quantity: 1, unitPriceMinor: 4999, basePriceMinor: 5999, promotionPriceMinor: 4999, programDiscountMinor: null })
  const legacy = parseMarketplaceOrder({ ...WIRE, orderLines: [{ offer: { offerId: "off-1", price: { amount: 12.5, currency: "PLN" } } }] })
  assert.equal(legacy.lines[0].unitPriceMinor, 1250, "without finalPrice the price is used")
  const program = parseMarketplaceOrder({ ...WIRE, orderLines: [{ offer: { offerId: "off-1", finalPrice: { amount: 9.5, currency: "PLN" }, programPrice: { price: { amount: 9.5, currency: "PLN" }, discount: { amount: 0.5, currency: "PLN" } } } }] })
  assert.equal(program.lines[0].programDiscountMinor, 50)
})

test("parse: one wire line per piece is added up per offer and price", () => {
  const o = parseMarketplaceOrder(WIRE)
  assert.equal(o.lines.length, 2)
  assert.equal(o.lines[1].offerId, "off-2")
  assert.equal(o.lines[1].quantity, 2)
  const quantity = parseMarketplaceOrder({ ...WIRE, orderLines: [{ offer: { offerId: "off-2", finalPrice: { amount: 20, currency: "PLN" } }, quantity: 3 }] })
  assert.equal(quantity.lines[0].quantity, 3, "an explicit quantity is honoured")
})

test("lines: the same offer at another price stays its own line", () => {
  const added = addUpLines([line(), line(), line({ unitPriceMinor: 3999 }), line({ offerId: "off-2", externalId: null })])
  assert.deepEqual(
    added.map((l) => [l.offerId, l.unitPriceMinor, l.quantity]),
    [
      ["off-1", 4999, 2],
      ["off-1", 3999, 1],
      ["off-2", 4999, 1],
    ],
  )
  assert.deepEqual(addUpLines([line({ quantity: 0 }), line()]).map((l) => l.quantity), [0, 1], "a broken piece is never hidden in a sum")
})

test("parse: paid means a payment is booked, cash on delivery never is", () => {
  const o = parseMarketplaceOrder(WIRE)
  assert.equal(o.paid, true)
  assert.equal(o.paidAt, PAID_AT, "the first payment")
  const unpaid = parseMarketplaceOrder({ ...WIRE, paymentDetails: { selectedPaymentType: "BLIK_CODE", payments: [] } })
  assert.equal(unpaid.paid, false)
  assert.equal(unpaid.paidAt, null)
  const cod = parseMarketplaceOrder({ ...WIRE, paymentDetails: { selectedPaymentType: "CASH_ON_DELIVERY", payments: [{ paymentId: "p", paymentType: "CASH_ON_DELIVERY", paymentDate: PAID_AT }] } })
  assert.equal(cod.paid, false)
})

test("parse: a phone in either shape the API sends", () => {
  assert.equal(phoneOf({ countryPrefix: "48", number: "500 000 000" }), "+48500000000")
  assert.equal(phoneOf({ countryPrefix: "+48", number: "500000000" }), "+48500000000")
  assert.equal(phoneOf({ country_prefix: "48", number: "500000000" }), "+48500000000")
  assert.equal(phoneOf({ number: "+48500000000" }), "+48500000000")
  assert.equal(phoneOf({ number: "500000000" }), "500000000")
  assert.equal(phoneOf("+48 500 000 000"), "+48500000000")
  assert.equal(phoneOf({}), null)
  assert.equal(phoneOf(null), null)
  assert.equal(parseMarketplaceOrder(WIRE).buyer.phone, "+48500000000")
})

test("parse: the invoice with its own e-mail, a company by its name", () => {
  const o = parseMarketplaceOrder({ ...WIRE, invoice: { companyName: "Firma Testowa sp. z o.o.", taxId: "0000000000", email: "faktury@example.com", address: { street: "Fakturowa", building: "5", city: "Kraków", postCode: "30-001", countryCode: "PL" } } })
  assert.equal(o.invoice?.email, "faktury@example.com")
  assert.equal(o.invoice?.companyName, "Firma Testowa sp. z o.o.")
  assert.equal(o.invoice?.address?.city, "Kraków")
  assert.equal(parseMarketplaceOrder(WIRE).invoice, null)
})

test("parse: snake_case and nothing at all never throw", () => {
  const snake = parseMarketplaceOrder({ id: "x", status: "created", order_lines: [{ offer: { offer_id: "off-1", final_price: { amount: 1, currency: "PLN" } } }], final_price: { amount: 1, currency: "PLN" }, payment_details: { selected_payment_type: "CASH_ON_DELIVERY" } })
  assert.equal(snake.status, "CREATED")
  assert.equal(snake.lines[0].offerId, "off-1")
  assert.equal(snake.lines[0].unitPriceMinor, 100)
  assert.equal(snake.paymentType, "CASH_ON_DELIVERY")
  assert.equal(snake.paid, false)
  const empty = parseMarketplaceOrder(null)
  assert.equal(empty.id, "")
  assert.equal(empty.status, "UNKNOWN")
  assert.equal(empty.currency, "PLN")
  assert.equal(empty.delivery.type, "UNKNOWN")
  assert.deepEqual(empty.delivery.parcels, [])
})

test("facts: statuses, money, parcels and dates, never the buyer's personal data", () => {
  const f = orderFacts(parseMarketplaceOrder({ ...WIRE, invoice: { companyName: "Firma Testowa sp. z o.o.", taxId: "0000000000" } }))
  assert.equal(f.remote_status, "ACCEPTED")
  assert.equal(f.delivery_type, "APM")
  assert.equal(f.delivery_point, "WAW01M")
  assert.equal(f.payment_type, "BLIK_CODE")
  assert.equal(f.currency_code, "pln")
  assert.equal(f.total_minor, 9998)
  assert.equal(f.delivery_minor, 999)
  assert.equal(f.buyer_kind, "COMPANY")
  assert.equal(f.base_total_minor, 5999 + 2 * 2000)
  assert.equal(f.promotion_discount_minor, 1000)
  assert.equal(f.program_discount_minor, 0)
  assert.deepEqual(f.placed_at, new Date("2026-10-18T10:00:00Z"))
  assert.deepEqual(f.paid_at, new Date(PAID_AT))
  assert.deepEqual(f.shipped_at, new Date("2026-10-19T08:00:00Z"), "the first parcel")
  assert.deepEqual(f.expected_delivery_at, new Date("2026-10-20T12:00:00Z"))
  assert.equal((f.parcels as unknown[]).length, 1)
  const text = JSON.stringify(f)
  for (const personal of ["buyer@example.com", "order-1@example.org", "Testowy", "Przykładowa", "500000000", "Firma Testowa"]) assert.ok(!text.includes(personal), personal)
  for (const key of ["email", "phone", "tax_id", "nip", "address"]) assert.ok(!(key in f), key)
})

test("facts: a person on the invoice, no invoice, no parcel, an unknown delivery", () => {
  assert.equal(orderFacts(parseMarketplaceOrder({ ...WIRE, invoice: { firstName: "Jan", lastName: "Testowy" } })).buyer_kind, "PERSON")
  const bare = orderFacts(parseMarketplaceOrder({ id: "x" }))
  assert.equal(bare.buyer_kind, null)
  assert.equal(bare.shipped_at, null)
  assert.equal(bare.delivery_type, null)
  assert.equal(bare.base_total_minor, null)
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
    d.order.items.map((i) => [i.variant_id, i.quantity, i.unit_price, i.is_tax_inclusive, i.is_discountable]),
    [
      ["variant_1", 1, 49.99, true, false],
      ["variant_2", 2, 20, true, false],
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
  assert.equal(d.paid, true)
  assert.equal(d.lines[1].unit_price_minor, 2000)
  const demo = planImport(parseMarketplaceOrder(WIRE), { ...CTX, demo: true, shippingOptionId: null })
  assert.equal(demo.kind === "create" && demo.order.metadata.koda_demo, true)
  assert.equal(demo.kind === "create" && "shipping_option_id" in demo.order.shipping_methods[0], false)
})

test("plan: the order's e-mail is InPost's per order address, the buyer's only without it", () => {
  const d = planImport(parseMarketplaceOrder(WIRE), CTX)
  assert.equal(d.kind === "create" && d.email, "order-1@example.org")
  const without = planImport(parseMarketplaceOrder({ ...WIRE, delivery: { ...WIRE.delivery, email: undefined } }), CTX)
  assert.equal(without.kind === "create" && without.email, "buyer@example.com")
})

test("plan: a company invoice becomes the billing address with the company and the tax id", () => {
  const d = planImport(parseMarketplaceOrder({ ...WIRE, invoice: { companyName: "Firma Testowa sp. z o.o.", taxId: "0000000000", address: { street: "Fakturowa", building: "5", city: "Kraków", postCode: "30-001", countryCode: "PL" } } }), CTX)
  assert.equal(d.kind, "create")
  if (d.kind !== "create") return
  assert.equal(d.order.billing_address.company, "Firma Testowa sp. z o.o.")
  assert.equal(d.order.billing_address.city, "Kraków")
  assert.equal(d.order.metadata.nip, "0000000000")
})

test("plan: lines are matched by offer id, then external id, then SKU", () => {
  const l = parseMarketplaceOrder(WIRE).lines[0]
  assert.equal(matchLine(l, CTX.offers)?.variantId, "variant_1")
  assert.equal(matchLine({ ...l, offerId: "zzz" }, CTX.offers)?.variantId, "variant_1")
  assert.equal(matchLine({ ...l, offerId: "zzz", externalId: null, sku: "sku-2" }, CTX.offers)?.variantId, "variant_2")
  assert.equal(matchLine({ ...l, offerId: "zzz", externalId: null, sku: null }, CTX.offers), null)
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
  assert.equal(hold({ ...raw, status: "REFUSED" }), "cancelled")
  assert.equal(hold({ ...raw, lines: [] }), "no_lines")
  assert.equal(hold({ ...raw, lines: [{ ...raw.lines[0], quantity: 0 }] }), "bad_line")
  assert.equal(hold({ ...raw, lines: [{ ...raw.lines[0], unitPriceMinor: 0 }] }), "bad_line")
  assert.equal(hold(raw, { ...CTX, regionId: null }), "no_region")
  assert.equal(hold(raw, { ...CTX, salesChannelId: null }), "no_channel")
  assert.equal(hold({ ...raw, currency: "EUR" }), "currency_mismatch")
  assert.equal(hold({ ...raw, delivery: { ...raw.delivery, address: null }, buyer: { ...raw.buyer, address: null } }), "no_address")
})

test("plan: an unpaid order waits for its payment, cash on delivery is imported unpaid", () => {
  const raw = parseMarketplaceOrder(WIRE)
  const unpaid = planImport({ ...raw, paid: false, paidAt: null }, CTX)
  assert.equal(unpaid.kind, "hold")
  assert.equal(unpaid.kind === "hold" && unpaid.code, "unpaid")
  const cod = planImport({ ...raw, paid: false, paidAt: null, paymentType: "CASH_ON_DELIVERY" }, CTX)
  assert.equal(cod.kind, "create")
  assert.equal(cod.kind === "create" && cod.paid, false)
})

test("plan: an order the marketplace has not accepted yet waits, after the payment check", () => {
  const raw = parseMarketplaceOrder(WIRE)
  const created = planImport({ ...raw, status: "CREATED" }, CTX)
  assert.equal(created.kind === "hold" && created.code, "not_accepted")
  const createdUnpaid = planImport({ ...raw, status: "CREATED", paid: false, paidAt: null }, CTX)
  assert.equal(createdUnpaid.kind === "hold" && createdUnpaid.code, "unpaid", "the payment is named first")
  const createdCod = planImport({ ...raw, status: "CREATED", paid: false, paidAt: null, paymentType: "CASH_ON_DELIVERY" }, CTX)
  assert.equal(createdCod.kind === "hold" && createdCod.code, "not_accepted")
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
