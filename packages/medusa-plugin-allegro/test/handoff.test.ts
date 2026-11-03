/**
 * The shipping method data of an imported Allegro order, the pure parts:
 * what the import asks the provider of the mapped shipping option, and when
 * its answer is kept. The provider answers below have the shape the InPost
 * plugin of Koda Plus returns from `validateFulfillmentData`.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { checkoutFormFromApi, type CheckoutForm } from "../src/modules/allegro/lib/checkout.ts"
import { handoffNeedsAttention, handoffRequest, handoffResult, importTotalMinor, keptWithoutProvider, refused } from "../src/modules/allegro/lib/handoff.ts"
import { planImport, type ImportContext } from "../src/modules/allegro/lib/import.ts"
import { importLine } from "../src/modules/allegro/lib/integration.ts"

const BASE = {
  id: "29738e61-7f6a-11e8-ac45-09db60ede9d6",
  status: "READY_FOR_PROCESSING",
  buyer: { id: "1", email: "buyer@example.com", login: "kupujacy", firstName: "Jan", lastName: "Testowy" },
  fulfillment: { status: "NEW" },
  invoice: { required: false },
  lineItems: [{ id: "line-1", offer: { id: "17000000001", name: "Wkrętarka 18V", external: { id: "ks-wk-18v" } }, quantity: 1, price: { amount: "129.99", currency: "PLN" } }],
  marketplace: { id: "allegro-pl" },
}
const ADDRESS = { firstName: "Jan", lastName: "Testowy", street: "Długa 1", city: "Kraków", zipCode: "30-001", countryCode: "PL" }
const PAID = { id: "p1", type: "ONLINE", paidAmount: { amount: "139.98", currency: "PLN" } }
const COD = { id: "p1", type: "CASH_ON_DELIVERY", paidAmount: null }

function form(over: Record<string, unknown>): CheckoutForm {
  const f = checkoutFormFromApi({ ...BASE, summary: { totalToPay: { amount: "139.98", currency: "PLN" } }, ...over })
  assert.ok(f)
  return f
}
const locker = (payment: Record<string, unknown> = PAID, total = "139.98") =>
  form({
    payment,
    summary: { totalToPay: { amount: total, currency: "PLN" } },
    delivery: { address: ADDRESS, method: { id: "m-locker", name: "Allegro Paczkomaty InPost" }, pickupPoint: { id: "KRA01M", name: "Paczkomat KRA01M" }, cost: { amount: "9.99", currency: "PLN" } },
  })
const courier = (payment: Record<string, unknown> = PAID) =>
  form({ payment, delivery: { address: ADDRESS, method: { id: "m-courier", name: "Allegro Kurier24 InPost" }, cost: { amount: "9.99", currency: "PLN" } } })

/** The total of the Medusa order the import makes of them: 129.99 + 9.99. */
const TOTAL = 13998

const OWN = { allegro_delivery_method_id: "m-locker", allegro_pickup_point_id: "KRA01M" }
const CONTEXT = { currency_code: "pln", shipping_address: { address_1: "Długa 1", city: "Kraków", postal_code: "30-001", country_code: "pl" } }

/** The InPost plugin's normalized method data (`methodDataFor`). */
const inpost = (option: string, kind: "locker" | "courier", cod: boolean, machine: string | null) => ({
  type: kind === "locker" ? "paczkomat" : "kurier",
  cod,
  machine_id: machine,
  machine_name: machine,
  machine_address: null,
  inpost_option: option,
  inpost_kind: kind,
  inpost_service: kind === "locker" ? "inpost_locker_standard" : "inpost_courier_standard",
  inpost_parcel_size: null,
})

const codeOf = (r: ReturnType<typeof handoffResult>): string | null => (r.kind === "kept" ? r.code : null)

test("option source: an option mapped to the delivery method by id or name is 'method', the default option is 'default'", () => {
  const ctx = (over: Partial<ImportContext>): ImportContext => ({
    regionId: "reg_pl",
    currency: "pln",
    salesChannelId: "sc",
    byOffer: new Map(),
    bySku: new Map([["KS-WK-18V", { id: "variant_1", productId: "prod_1", sku: "KS-WK-18V", productTitle: null }]]),
    shippingOptionId: null,
    shippingOptions: {},
    demo: false,
    ...over,
  })
  const source = (c: ImportContext) => {
    const d = planImport(locker(), c)
    assert.equal(d.kind, "create")
    return d.kind === "create" ? [d.order.shipping_methods[0].shipping_option_id ?? null, d.shippingOptionSource] : null
  }
  assert.deepEqual(source(ctx({ shippingOptions: { "m-locker": "so_locker" }, shippingOptionId: "so_default" })), ["so_locker", "method"])
  assert.deepEqual(source(ctx({ shippingOptions: { "Allegro Paczkomaty InPost": "so_locker" } })), ["so_locker", "method"])
  assert.deepEqual(source(ctx({ shippingOptionId: "so_default" })), ["so_default", "default"])
  assert.deepEqual(source(ctx({})), [null, null])
})

test("request: a pickup delivery names its point as a storefront would, a courier sends no data", () => {
  assert.deepEqual(handoffRequest(locker(), CONTEXT), { data: { machine_id: "KRA01M", machine_name: "Paczkomat KRA01M" }, context: CONTEXT })
  assert.deepEqual(handoffRequest(courier(), CONTEXT).data, {})
})

test("total: the lines and the delivery of the Medusa order, in grosze", () => {
  assert.equal(importTotalMinor({ items: [{ unit_price: 129.99, quantity: 1 }, { unit_price: 12.5, quantity: 2 }], shipping_methods: [{ amount: 9.99 }] }), 16498)
})

test("handed: a paid locker order on a parcel locker option carries the provider's data and keeps our keys", () => {
  const r = handoffResult(locker(), OWN, inpost("inpost-paczkomat", "locker", false, "KRA01M"), TOTAL)
  assert.equal(r.kind, "handed")
  assert.equal(r.data.inpost_option, "inpost-paczkomat")
  assert.equal(r.data.machine_id, "KRA01M")
  assert.equal(r.data.allegro_pickup_point_id, "KRA01M")
  assert.equal(handoffNeedsAttention(r), false)
})

test("handed: a courier order, Allegro Pay (not paid yet, not cash on delivery) and a provider that only echoes", () => {
  assert.equal(handoffResult(courier(), { allegro_delivery_method_id: "m-courier" }, inpost("inpost-kurier", "courier", false, null), TOTAL).kind, "handed")
  const pay = handoffResult(locker({ id: "p1", type: "EXTENDED_TERM", paidAmount: null }), OWN, inpost("inpost-paczkomat", "locker", false, "KRA01M"), TOTAL)
  assert.equal(pay.kind, "handed")
  assert.equal(handoffResult(locker(), OWN, { machine_id: "KRA01M", machine_name: "Paczkomat KRA01M" }, TOTAL).kind, "handed")
})

test("handed: cash on delivery on a cash on delivery option, when it collects the buyer's Allegro total", () => {
  const r = handoffResult(locker(COD), OWN, inpost("inpost-paczkomat-cod", "locker", true, "KRA01M"), TOTAL)
  assert.equal(r.kind, "handed")
  assert.equal(r.data.cod, true)
})

test("kept: cash on delivery never collects an amount other than the buyer's Allegro total", () => {
  const answer = inpost("inpost-paczkomat-cod", "locker", true, "KRA01M")
  const r = handoffResult(locker(COD, "142.98"), OWN, answer, TOTAL)
  assert.equal(codeOf(r), "cod_total_mismatch")
  assert.deepEqual(r.data, OWN)
  assert.match(r.kind === "kept" ? r.reason : "", /139\.98.*142\.98/)
  assert.equal(codeOf(handoffResult(locker(COD), OWN, answer, null)), "cod_total_mismatch")
  /* A prepaid order collects nothing: its total is not compared. */
  assert.equal(handoffResult(locker(PAID, "142.98"), OWN, inpost("inpost-paczkomat", "locker", false, "KRA01M"), TOTAL).kind, "handed")
})

test("kept: a missing or unknown payment type is never handed over", () => {
  for (const payment of [{ id: "p1", type: null, paidAmount: null }, { id: "p1", type: "SOMETHING_NEW", paidAmount: null }]) {
    const r = handoffResult(locker(payment), OWN, inpost("inpost-paczkomat", "locker", false, "KRA01M"), TOTAL)
    assert.equal(codeOf(r), "payment_unknown")
    assert.deepEqual(r.data, OWN)
    assert.equal(handoffNeedsAttention(r), true)
  }
})

test("kept: a pickup delivery on an option that drops the point never becomes a courier parcel", () => {
  const r = handoffResult(locker(), OWN, inpost("inpost-kurier", "courier", false, null), TOTAL)
  assert.equal(codeOf(r), "locker_dropped")
  assert.deepEqual(r.data, OWN)
  assert.match(r.kind === "kept" ? r.reason : "", /KRA01M.*Allegro Paczkomaty InPost/)
})

test("kept: cash on delivery follows the payment type both ways, never 'not paid'", () => {
  const unpaid = handoffResult(locker(COD), OWN, inpost("inpost-paczkomat", "locker", false, "KRA01M"), TOTAL)
  assert.equal(codeOf(unpaid), "cod_mismatch")
  const twice = handoffResult(courier(), { allegro_delivery_method_id: "m-courier" }, inpost("inpost-kurier-cod", "courier", true, null), TOTAL)
  assert.equal(codeOf(twice), "cod_mismatch")
  assert.match(twice.kind === "kept" ? twice.reason : "", /pay twice/)
  /* Allegro Pay is not paid at import, and still never cash on delivery. */
  const pay = handoffResult(locker({ id: "p1", type: "EXTENDED_TERM", paidAmount: null }), OWN, inpost("inpost-paczkomat-cod", "locker", true, "KRA01M"), TOTAL)
  assert.equal(codeOf(pay), "cod_mismatch")
})

test("kept: demo orders, unmapped methods, the default option and refusals keep only our keys", () => {
  for (const why of ["demo", "no_option", "default_option"] as const) {
    const r = keptWithoutProvider(OWN, why)
    assert.deepEqual(r.data, OWN)
    assert.equal(handoffNeedsAttention(r), false, why)
  }
  const r = refused(OWN, "Paczkomat XYZ01M does not exist.")
  assert.deepEqual(r.data, OWN)
  assert.match(r.kind === "kept" ? r.reason : "", /refused.*XYZ01M/)
  assert.equal(handoffNeedsAttention(r), true)
})

test("order card: a row flagged by the handoff says shipping needs a person, a buyer change keeps its own hint", () => {
  const hint = (details: Record<string, unknown>) => importLine({ status: "imported", attention: "Something to check.", total_mismatch: false, details } as never).detail
  assert.deepEqual(hint({ handoff: "locker_dropped" }), { key: "integration.order.handoffHint" })
  assert.deepEqual(hint({ handoff: "handed_cod_total_mismatch" }), { key: "integration.order.handoffHint" })
  assert.deepEqual(hint({ handoff: "handed" }), { key: "integration.order.attentionHint" })
  assert.deepEqual(hint({}), { key: "integration.order.attentionHint" })
})
