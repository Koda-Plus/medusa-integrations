import { test } from "node:test"
import assert from "node:assert/strict"
import {
  PayloadError,
  buildAddOrderPayload,
  isSkipped,
  orderMarker,
  paymentFacts,
  pickupPoint,
  type OrderRecord,
} from "../src/modules/baselinker/lib/order-payload.ts"

const address = {
  first_name: "Anna",
  last_name: "Nowak",
  company: "",
  address_1: "ul. Przykładowa 12",
  address_2: "m. 3",
  postal_code: "60-101",
  city: "Poznań",
  province: null,
  country_code: "pl",
  phone: "+48 600 000 000",
}

const order: OrderRecord = {
  id: "order_01JDEMO0000000000000000001",
  display_id: 1042,
  email: "anna.nowak@example.com",
  currency_code: "pln",
  created_at: "2026-10-05T09:15:00.000Z",
  metadata: { customer_note: "Proszę o kontakt przed wysyłką." },
  total: { numeric: 1255 },
  shipping_total: 15,
  discount_total: 20,
  shipping_address: address,
  billing_address: address,
  items: [
    {
      id: "ordli_1",
      title: "Opona zimowa 205/55 R16",
      variant_id: "variant_linked",
      variant_sku: "OP-205-55",
      variant_barcode: "5901234123457",
      quantity: 99,
      detail: { quantity: 4 },
      total: { numeric: 1220 },
      tax_lines: [{ rate: 8 }, { rate: 23 }],
    },
    { id: "ordli_2", title: "Wentyl", variant_id: "variant_free", variant_sku: "WEN-1", detail: { quantity: 4 }, total: "20", tax_lines: [{ rate: 23 }] },
    { id: "ordli_3", title: "Usunięta pozycja", variant_id: "variant_x", detail: { quantity: 0 }, total: 0 },
  ],
  shipping_methods: [{ name: "Kurier DPD, dostawa na jutro przed 12:00", amount: 15, data: {} }],
  payment_collections: [{ status: "authorized", payments: [{ provider_id: "pp_cod_cod", amount: 1255 }] }],
}

const options = { orderStatusId: 122665, customSourceId: 20188, inventoryId: 23397, codProviders: ["pp_cod", "pp_cash"] }
const links = new Map([["variant_linked", "232696614"]])

test("a linked line goes to its card, any other line goes as a free line", () => {
  const { payload, linked, unlinked } = buildAddOrderPayload(order, links, options)
  assert.equal(payload.products.length, 2, "the line edited down to zero is skipped")
  assert.deepEqual(payload.products[0], {
    storage: "db",
    storage_id: 23397,
    product_id: "232696614",
    name: "Opona zimowa 205/55 R16",
    sku: "OP-205-55",
    ean: "5901234123457",
    price_brutto: 305,
    tax_rate: 23,
    quantity: 4,
  })
  assert.equal(payload.products[1].product_id, undefined)
  assert.equal(payload.products[1].storage, undefined)
  assert.equal(payload.products[1].price_brutto, 5)
  assert.equal(linked, 1)
  assert.deepEqual(unlinked, ["WEN-1"])
})

test("quantity comes from items.detail; an unreadable quantity stops the payload", () => {
  const broken = { ...order, items: [{ id: "ordli_9", title: "X", total: 10 }] }
  assert.throws(() => buildAddOrderPayload(broken, links, options), (err: unknown) => err instanceof PayloadError && err.code === "no_quantity" && !err.retryable)
  const empty = { ...order, items: [{ id: "ordli_9", title: "X", detail: { quantity: 0 }, total: 0 }] }
  assert.throws(() => buildAddOrderPayload(empty, links, options), (err: unknown) => err instanceof PayloadError && err.code === "no_lines")
})

test("unit price keeps the discount and multiplies back to the line total", () => {
  const { payload } = buildAddOrderPayload(
    { ...order, items: [{ id: "l", title: "T", variant_sku: "T-1", detail: { quantity: 3 }, total: 100, tax_lines: [] }] },
    links,
    options,
  )
  assert.equal(payload.products[0].price_brutto, 33.33)
  assert.equal(payload.products[0].tax_rate, 0)
})

test("cash on delivery by provider prefix: COD flag on, paid 0", () => {
  const { payload } = buildAddOrderPayload(order, links, options)
  assert.equal(payload.payment_method_cod, true)
  assert.equal(payload.paid, 0)
  assert.equal(payload.payment_method, "Cash on delivery")
})

test("paid is 1 only when the payment is captured in full", () => {
  const captured = [{ status: "completed", payments: [{ provider_id: "pp_stripe_stripe", amount: 1255, captured_at: "2026-10-05T09:15:04Z" }] }]
  assert.equal(buildAddOrderPayload({ ...order, payment_collections: captured }, links, options).payload.paid, 1)
  assert.equal(buildAddOrderPayload({ ...order, payment_collections: captured }, links, options).payload.payment_method_cod, false)

  const partial = [{ status: "partially_captured", payments: [{ provider_id: "pp_stripe_stripe", amount: 1255, captures: [{ amount: 500 }] }] }]
  assert.equal(buildAddOrderPayload({ ...order, payment_collections: partial }, links, options).payload.paid, 0)

  const authorized = [{ status: "authorized", payments: [{ provider_id: "pp_stripe_stripe", amount: 1255 }] }]
  assert.equal(buildAddOrderPayload({ ...order, payment_collections: authorized }, links, options).payload.paid, 0)
  assert.deepEqual(paymentFacts(authorized, 1255, ["pp_cod"]), { providerId: "pp_stripe_stripe", captured: false, cod: false, amountCaptured: 0 })
})

test("the marker opens admin_comments and survives the 200 character limit", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, title: `Line ${i}`, variant_sku: `SKU-NOT-LINKED-${i}`, detail: { quantity: 1 }, total: 1 }))
  const { payload, marker } = buildAddOrderPayload({ ...order, items: many }, links, options)
  assert.equal(marker, orderMarker(order.id))
  assert.equal(marker, "[medusa:order_01JDEMO0000000000000000001]")
  assert.ok(payload.admin_comments.startsWith(marker))
  assert.ok(payload.admin_comments.length <= 200)
  assert.match(buildAddOrderPayload(order, links, options).payload.admin_comments, /Medusa #1042 \| discount 20\.00 PLN \| not in the BaseLinker catalog: WEN-1/)
})

test("address, status, source, shipping and the buyer's note", () => {
  const { payload } = buildAddOrderPayload(order, links, options)
  assert.equal(payload.order_status_id, 122665)
  assert.equal(payload.custom_source_id, 20188)
  assert.equal(payload.date_add, Date.parse("2026-10-05T09:15:00.000Z") / 1000)
  assert.equal(payload.currency, "PLN")
  assert.equal(payload.delivery_fullname, "Anna Nowak")
  assert.equal(payload.delivery_address, "ul. Przykładowa 12 m. 3")
  assert.equal(payload.delivery_country_code, "PL")
  assert.equal(payload.delivery_company, undefined, "an empty company is not sent")
  assert.equal(payload.delivery_price, 15)
  assert.equal(payload.delivery_method, "Kurier DPD, dostawa na jutro p", "30 characters")
  assert.equal(payload.user_comments, "Proszę o kontakt przed wysyłką.")
  assert.equal(payload.want_invoice, undefined)
})

test("invoice fields go only when the buyer asked for one", () => {
  const { payload } = buildAddOrderPayload({ ...order, metadata: { invoice_nip: "PL1234563218", invoice_company: "Opony Nowak sp. z o.o." } }, links, options)
  assert.equal(payload.want_invoice, "1")
  assert.equal(payload.invoice_nip, "PL1234563218")
  assert.equal(payload.invoice_company, "Opony Nowak sp. z o.o.")
  assert.equal(payload.invoice_postcode, "60-101")
})

test("an InPost locker from the shipping method data", () => {
  assert.deepEqual(pickupPoint({ target_point: { id: "POZ08M", name: "Paczkomat POZ08M", address: { line1: "ul. Głogowska 1", line2: "60-101 Poznań" } } }), {
    id: "POZ08M",
    name: "Paczkomat POZ08M",
    address: "ul. Głogowska 1",
    postcode: "60-101",
    city: "Poznań",
  })
  const { payload } = buildAddOrderPayload({ ...order, shipping_methods: [{ name: "Paczkomat", amount: 12, data: { locker_id: "WAW01A" } }] }, links, options)
  assert.equal(payload.delivery_point_id, "WAW01A")
})

test("test orders: the skip key keeps an order out", () => {
  assert.equal(isSkipped({ baselinker_skip: true }, "baselinker_skip"), true)
  assert.equal(isSkipped({ baselinker_skip: "true" }, "baselinker_skip"), true)
  assert.equal(isSkipped({ baselinker_skip: false }, "baselinker_skip"), false)
  assert.equal(isSkipped(null, "baselinker_skip"), false)
})

test("payment labels: custom names by prefix win, longest prefix first", async () => {
  const { paymentLabel } = await import("../src/modules/baselinker/lib/order-payload.ts")
  const { resolveOptions } = await import("../src/modules/baselinker/lib/options.ts")
  const o = resolveOptions({ paymentLabels: { pp_cod: "Pobranie", pp_stripe: "Karta", "pp_stripe-blik": "BLIK" } })
  assert.equal(paymentLabel("pp_stripe-blik_stripe", false, o.paymentLabels), "BLIK")
  assert.equal(paymentLabel("pp_stripe_stripe", false, o.paymentLabels), "Karta")
  assert.equal(paymentLabel("pp_cod_manual", true, o.paymentLabels), "Pobranie")
  assert.equal(paymentLabel("pp_payu_payu", false, o.paymentLabels), "PayU")
  assert.equal(paymentLabel("pp_payu_payu", false), "PayU")
})
