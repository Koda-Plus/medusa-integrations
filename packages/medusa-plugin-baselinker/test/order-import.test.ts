import { test } from "node:test"
import assert from "node:assert/strict"
import {
  cancelDecision,
  exportVerdict,
  importVerdict,
  mapOrder,
  marketplaceRef,
  nextCursor,
  orderTotal,
  paymentState,
  splitName,
  tooOld,
  unseen,
  type BlOrder,
} from "../src/modules/baselinker/lib/order-import.ts"
import {
  DEMO_MAX_ORDERS_PER_DAY,
  dayNumber,
  demoMarketplaceOrder,
  demoMarketplaceOrderById,
  demoMarketplaceOrders,
  demoReturns,
  ordersOfDay,
} from "../src/modules/baselinker/lib/demo-marketplace.ts"
import { parseReturns, RETURN_FIELDS_DROPPED } from "../src/modules/baselinker/lib/returns.ts"

const allegro: BlOrder = {
  order_id: 5001,
  external_order_id: "29738E61-7F6E-11E8-AC45-09DB60EDE9D6",
  order_source: "allegro",
  order_source_id: 1455,
  order_status_id: 7,
  confirmed: true,
  date_confirmed: 1_790_000_000,
  currency: "PLN",
  payment_method_cod: "0",
  payment_done: 129.98,
  email: "abc+1@allegromail.pl",
  phone: "+48 600 100 200",
  user_comments: "Proszę zadzwonić",
  admin_comments: "",
  delivery_method: "Allegro Paczkomaty InPost",
  delivery_price: 9.99,
  delivery_fullname: "Jan Maria Kowalski",
  delivery_address: "ul. Długa 1",
  delivery_postcode: "00-001",
  delivery_city: "Warszawa",
  delivery_country_code: "PL",
  delivery_point_id: "WAW01M",
  delivery_point_name: "Paczkomat WAW01M",
  want_invoice: "1",
  invoice_fullname: "Jan Kowalski",
  invoice_company: "Kowalski Sp. z o.o.",
  invoice_nip: "5250000000",
  invoice_address: "ul. Krótka 2",
  invoice_postcode: "00-002",
  invoice_city: "Warszawa",
  invoice_country_code: "PL",
  products: [
    { order_product_id: 1, product_id: "101", variant_id: "0", name: "Opona A", sku: "OP-A", price_brutto: 59.995, tax_rate: 23, quantity: 2 },
    { order_product_id: 2, product_id: "999", variant_id: "0", name: "Nieznany", sku: "X-1", price_brutto: 0, tax_rate: 23, quantity: 1 },
  ],
}

const rules = [{ type: "allegro", id: null }, { type: "amazon", id: 7245 }]

test("which orders qualify: selected sources, never our own exports, never our own source", () => {
  assert.deepEqual(importVerdict(allegro, { rules, customSourceId: 77 }), { import: true })
  assert.deepEqual(importVerdict({ ...allegro, admin_comments: "[medusa:order_01J] Medusa #12" }, { rules, customSourceId: 77 }), { import: false, reason: "own_export" })
  assert.deepEqual(importVerdict({ ...allegro, order_source: "personal", order_source_id: 77 }, { rules: [...rules, { type: "personal", id: null }], customSourceId: 77 }), {
    import: false,
    reason: "own_source",
  })
  assert.deepEqual(importVerdict({ ...allegro, order_source: "amazon", order_source_id: 1 }, { rules, customSourceId: null }), { import: false, reason: "not_selected" })
  assert.deepEqual(importVerdict({ ...allegro, confirmed: false }, { rules, customSourceId: null }), { import: false, reason: "unconfirmed" })
})

test("the marketplace reference is shared with the other plugins: source and external id, lowercased", () => {
  assert.equal(marketplaceRef(allegro), "allegro:29738e61-7f6e-11e8-ac45-09db60ede9d6")
  assert.equal(marketplaceRef({ ...allegro, external_order_id: "" }), null)
  assert.equal(marketplaceRef({ ...allegro, order_source: "personal" }), null)
})

test("payment: paid in full, cash on delivery, part paid, waiting", () => {
  assert.equal(orderTotal(allegro), 129.98)
  assert.equal(paymentState(allegro), "paid")
  assert.equal(paymentState({ ...allegro, payment_done: 0, payment_method_cod: "1" }), "cod")
  assert.equal(paymentState({ ...allegro, payment_done: 50 }), "partial")
  assert.equal(paymentState({ ...allegro, payment_done: 0 }), "awaiting")
})

test("mapping: lines by the card link, unlinked lines kept as custom lines, gross prices, addresses, invoice data, no e-mail in the input", () => {
  const mapped = mapOrder(allegro, { regionId: "reg_pl", salesChannelId: "sc_1", shippingOptionId: null, links: new Map([["101", "var_a"]]) })
  const input = mapped.input as Record<string, any>
  assert.equal(input.status, "draft")
  assert.equal(input.is_draft_order, true)
  assert.equal(input.no_notification, true)
  assert.equal(input.email, undefined, "no guest customer from the e-mail")
  assert.equal(mapped.email, "abc+1@allegromail.pl")
  assert.equal(input.currency_code, "pln")
  assert.deepEqual(input.items[0], {
    variant_id: "var_a",
    title: "Opona A",
    quantity: 2,
    unit_price: 60,
    is_tax_inclusive: true,
    metadata: { baselinker_order_product_id: "1", baselinker_product_id: "101", sku: "OP-A", baselinker_tax_rate: 23 },
  })
  assert.equal(input.items[1].variant_id, undefined)
  assert.deepEqual(mapped.unlinked, ["X-1"])
  assert.deepEqual(input.shipping_address, {
    first_name: "Jan",
    last_name: "Maria Kowalski",
    company: undefined,
    address_1: "ul. Długa 1",
    postal_code: "00-001",
    city: "Warszawa",
    province: undefined,
    country_code: "pl",
    phone: "+48 600 100 200",
  })
  assert.equal(input.billing_address.company, "Kowalski Sp. z o.o.")
  assert.equal(input.shipping_methods[0].amount, 9.99)
  assert.equal(input.shipping_methods[0].is_tax_inclusive, true)
  assert.equal(input.shipping_methods[0].data.pickup_point.id, "WAW01M")
  assert.equal(input.metadata.baselinker_order_id, "5001")
  assert.equal(input.metadata.baselinker_imported, true)
  assert.equal(input.metadata.marketplace_order_ref, "allegro:29738e61-7f6e-11e8-ac45-09db60ede9d6")
  assert.equal(input.metadata.invoice_nip, "5250000000")
  assert.equal(input.metadata.customer_note, "Proszę zadzwonić")
  assert.equal(mapped.payment, "paid")
  assert.deepEqual(splitName("Anna"), { first_name: "Anna", last_name: "" })
  assert.throws(() => mapOrder({ ...allegro, products: [] }, { regionId: "r", salesChannelId: null, shippingOptionId: null, links: new Map() }), /no lines/)
})

test("paging by date_confirmed loses nothing at a page boundary and always moves on", () => {
  const at = (id: number, t: number): BlOrder => ({ order_id: id, date_confirmed: t })
  const start = { dateConfirmed: 100, seen: [] as number[] }
  const page1 = [at(1, 100), at(2, 105), at(3, 105)]
  const step1 = nextCursor(start, page1, 3)
  assert.deepEqual(step1, { cursor: { dateConfirmed: 105, seen: [2, 3] }, more: true }, "the same second again, not plus one")
  const page2 = [at(2, 105), at(3, 105), at(4, 105)]
  assert.deepEqual(
    unseen(step1.cursor, page2).map((o) => o.order_id),
    [4],
  )
  const step2 = nextCursor(step1.cursor, page2, 3)
  assert.deepEqual(step2.cursor, { dateConfirmed: 106, seen: [] }, "a full page in one second: move on by one")
  assert.equal(nextCursor(start, [], 100).more, false)
})

test("age, cancellation and the export side of the loop guard", () => {
  const now = new Date("2026-10-06T12:00:00Z")
  assert.equal(tooOld(Math.floor(now.getTime() / 1000) - 73 * 3600, 72, now), true)
  assert.equal(tooOld(Math.floor(now.getTime() / 1000) - 71 * 3600, 72, now), false)
  assert.equal(cancelDecision({ statusId: 9, cancelIds: [9], fulfilledQuantity: 0, alreadyCanceled: false }), "cancel")
  assert.equal(cancelDecision({ statusId: 9, cancelIds: [9], fulfilledQuantity: 1, alreadyCanceled: false }), "flag")
  assert.equal(cancelDecision({ statusId: 8, cancelIds: [9], fulfilledQuantity: 0, alreadyCanceled: false }), "none")
  assert.equal(cancelDecision({ statusId: 9, cancelIds: [9], fulfilledQuantity: 0, alreadyCanceled: true }), "none")
  assert.deepEqual(exportVerdict({ baselinker_imported: true }, true), { send: false, reason: "imported", ref: null })
  assert.deepEqual(exportVerdict({ marketplace_order_ref: "allegro:x" }, false), { send: false, reason: "marketplace", ref: "allegro:x" })
  assert.deepEqual(exportVerdict({ marketplace_order_ref: "allegro:x" }, true), { send: true })
  assert.deepEqual(exportVerdict(null, false), { send: true })
})

const cards = [
  { blId: "101", sku: "KS-1", name: "Rękawice", price: 19.9 },
  { blId: "102", sku: "KS-2", name: "Taśma", price: null },
]

test("demo marketplace: one to five orders a day, deterministic, example.com buyers, the same order by id", () => {
  const now = new Date("2026-10-06T23:59:00Z")
  for (let d = dayNumber(now) - 30; d <= dayNumber(now); d += 1) {
    assert.ok(ordersOfDay(d) >= 1 && ordersOfDay(d) <= DEMO_MAX_ORDERS_PER_DAY)
  }
  const list = demoMarketplaceOrders({ now, days: 2, cards })
  assert.deepEqual(list, demoMarketplaceOrders({ now, days: 2, cards }), "deterministic")
  assert.ok(list.length >= 2 && list.length <= 10)
  for (const o of list) {
    assert.match(String(o.email), /@example\.com$/)
    assert.ok(["allegro", "amazon"].includes(String(o.order_source)))
    assert.deepEqual(demoMarketplaceOrderById(String(o.order_id), cards, now), o)
  }
  const early = new Date("2026-10-06T00:30:00Z")
  assert.ok(demoMarketplaceOrders({ now: early, days: 1, cards }).length === 0, "nothing confirmed before 7:00")
  assert.equal(demoMarketplaceOrder(dayNumber(now), 99, cards, now), null)
})

test("demo marketplace: the warehouse moves orders on, the fourth of a day is cancelled", () => {
  const day = dayNumber(new Date("2026-10-06T12:00:00Z"))
  const first = demoMarketplaceOrder(day, 0, cards, new Date("2026-10-06T23:00:00Z"))
  assert.ok(first)
  const confirmed = Number(first?.date_confirmed) * 1000
  const later = demoMarketplaceOrder(day, 0, cards, new Date(confirmed + 3 * 3600 * 1000))
  assert.ok(String(later?.delivery_package_nr).length > 10)
  if (ordersOfDay(day) >= 4) {
    const fourth = demoMarketplaceOrder(day, 3, cards, new Date("2026-10-07T23:00:00Z"))
    assert.equal(fourth?.order_status_id, 100005)
  }
})

test("returns: the raw answer carries personal data; the parser keeps none of it", () => {
  const sources = Array.from({ length: 40 }, (_, i) => ({ blOrderId: String(9_000_000 + i), source: "allegro", at: new Date("2026-10-01T10:00:00Z"), lines: [{ name: "Opona", sku: "OP-1", price: 300, quantity: 1 }] }))
  const raw = demoReturns(sources, new Date("2026-10-06T10:00:00Z"))
  assert.ok(raw.length > 0 && raw.length < sources.length)
  const parsed = parseReturns(raw, new Map([[1005, "Uszkodzony towar"]]))
  const stored = JSON.stringify(parsed)
  assert.ok(!stored.includes("example.com"))
  assert.ok(!stored.includes("Przykładowa"))
  assert.ok(!stored.includes("00000000000000000000000000"))
  assert.ok(!stored.includes("Komentarz"))
  assert.ok(RETURN_FIELDS_DROPPED.includes("order_return_iban"))
  assert.equal(parsed[0].products[0].name, "Opona")
  assert.equal(parsed[0].currency, "PLN")
})
