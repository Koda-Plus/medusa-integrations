/**
 * The shipping method data of an imported order, the pure parts: what the
 * import asks the provider of the mapped shipping option, and when its
 * answer is kept. The provider answers below have the shape the InPost
 * plugin of Koda Plus returns from `validateFulfillmentData`.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { handoffRequest, handoffResult, importTotalMinor, keptWithoutProvider, refused } from "../src/modules/vonhalsky/lib/handoff.ts"
import { parseMarketplaceOrder } from "../src/modules/vonhalsky/lib/orders.ts"

const BASE = {
  id: "8c4c2f2e-0000-4000-8000-000000000002",
  status: "CREATED",
  customer: { email: "buyer@example.com", firstName: "Jan", lastName: "Testowy", phoneNumber: "+48500000000", address: { street: "Przykładowa", building: "1", city: "Warszawa", postCode: "00-001", countryCode: "pl" } },
  orderLines: [{ offer: { offerId: "off-1", externalId: "variant_1", price: { amount: 49.99, currency: "PLN" } } }],
}

const locker = (payment: string | null = "BLIK_CODE") =>
  parseMarketplaceOrder({ ...BASE, finalPrice: { amount: 59.98, currency: "PLN" }, delivery: { deliveryType: "APM", deliveryPoint: "waw01m", price: { amount: 9.99, currency: "PLN" } }, paymentDetails: { selectedPaymentType: payment } })
const courier = (payment = "BLIK_CODE") =>
  parseMarketplaceOrder({ ...BASE, finalPrice: { amount: 64.98, currency: "PLN" }, delivery: { deliveryType: "COURIER", price: { amount: 14.99, currency: "PLN" } }, paymentDetails: { selectedPaymentType: payment } })

/** The totals of the Medusa orders the import makes of them: 49.99 + 9.99 and 49.99 + 14.99. */
const LOCKER_TOTAL = 5998
const COURIER_TOTAL = 6498

const OWN = { vonhalsky_delivery_type: "APM", vonhalsky_delivery_point: "waw01m" }
const CONTEXT = { currency_code: "pln", shipping_address: { address_1: "Przykładowa 1", city: "Warszawa", postal_code: "00-001", country_code: "pl" } }

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

test("request: a locker delivery names its locker as a storefront would, a courier sends no data", () => {
  assert.deepEqual(handoffRequest(locker(), CONTEXT), { data: { machine_id: "waw01m", machine_name: "waw01m" }, context: CONTEXT })
  assert.deepEqual(handoffRequest(courier(), CONTEXT).data, {})
  const noPoint = parseMarketplaceOrder({ ...BASE, delivery: { deliveryType: "APM", price: { amount: 9.99, currency: "PLN" } }, paymentDetails: { selectedPaymentType: "BLIK_CODE" } })
  assert.deepEqual(handoffRequest(noPoint, CONTEXT).data, {})
})

test("total: the lines and the delivery of the Medusa order, in grosze", () => {
  assert.equal(importTotalMinor({ items: [{ unit_price: 49.99, quantity: 1 }, { unit_price: 0.1, quantity: 3 }], shipping_methods: [{ amount: 9.99 }] }), 6028)
  assert.equal(importTotalMinor({ items: [], shipping_methods: [] }), 0)
})

test("handed: a paid locker order on a parcel locker option carries the provider's data and keeps our keys", () => {
  const r = handoffResult(locker(), OWN, inpost("inpost-paczkomat", "locker", false, "WAW01M"), LOCKER_TOTAL)
  assert.equal(r.kind, "handed")
  assert.equal(r.data.inpost_option, "inpost-paczkomat")
  assert.equal(r.data.machine_id, "WAW01M")
  assert.equal(r.data.vonhalsky_delivery_point, "waw01m")
  assert.equal(r.data.vonhalsky_delivery_type, "APM")
})

test("handed: a paid courier order on a courier option, and a provider that only echoes the data", () => {
  assert.equal(handoffResult(courier(), { vonhalsky_delivery_type: "COURIER" }, inpost("inpost-kurier", "courier", false, null), COURIER_TOTAL).kind, "handed")
  const manual = handoffResult(locker(), OWN, { machine_id: "waw01m", machine_name: "waw01m" }, LOCKER_TOTAL)
  assert.equal(manual.kind, "handed")
  assert.equal(manual.data.machine_id, "waw01m")
})

test("handed: cash on delivery on a cash on delivery option, when it collects the buyer's total", () => {
  const r = handoffResult(locker("CASH_ON_DELIVERY"), OWN, inpost("inpost-paczkomat-cod", "locker", true, "WAW01M"), LOCKER_TOTAL)
  assert.equal(r.kind, "handed")
  assert.equal(r.data.cod, true)
})

test("kept: cash on delivery never collects an amount other than the buyer's marketplace total", () => {
  const cod = locker("CASH_ON_DELIVERY")
  const answer = inpost("inpost-paczkomat-cod", "locker", true, "WAW01M")
  const r = handoffResult(cod, OWN, answer, LOCKER_TOTAL + 100)
  assert.equal(codeOf(r), "cod_total_mismatch")
  assert.deepEqual(r.data, OWN)
  assert.match(r.kind === "kept" ? r.reason : "", /60\.98.*59\.98/)
  assert.equal(codeOf(handoffResult({ ...cod, totalMinor: null }, OWN, answer, LOCKER_TOTAL)), "cod_total_mismatch")
  /* A prepaid order collects nothing: its total is not compared. */
  assert.equal(handoffResult(locker(), OWN, inpost("inpost-paczkomat", "locker", false, "WAW01M"), LOCKER_TOTAL + 100).kind, "handed")
})

test("kept: an unknown payment type is never handed over, cash on delivery or not", () => {
  for (const payment of ["UNKNOWN", null]) {
    const r = handoffResult(locker(payment), OWN, inpost("inpost-paczkomat", "locker", false, "WAW01M"), LOCKER_TOTAL)
    assert.equal(codeOf(r), "payment_unknown")
    assert.deepEqual(r.data, OWN)
  }
})

test("kept: a locker delivery on an option that drops the locker never becomes a courier parcel", () => {
  const r = handoffResult(locker(), OWN, inpost("inpost-kurier", "courier", false, null), LOCKER_TOTAL)
  assert.equal(codeOf(r), "locker_dropped")
  assert.deepEqual(r.data, OWN)
  assert.match(r.kind === "kept" ? r.reason : "", /waw01m/)
  assert.equal(codeOf(handoffResult(locker(), OWN, {}, LOCKER_TOTAL)), "locker_dropped")
})

test("kept: cash on delivery must agree with how the marketplace was paid, both ways", () => {
  const unpaid = handoffResult(locker("CASH_ON_DELIVERY"), OWN, inpost("inpost-paczkomat", "locker", false, "WAW01M"), LOCKER_TOTAL)
  assert.equal(codeOf(unpaid), "cod_mismatch")
  assert.deepEqual(unpaid.data, OWN)
  const twice = handoffResult(courier(), { vonhalsky_delivery_type: "COURIER" }, inpost("inpost-kurier-cod", "courier", true, null), COURIER_TOTAL)
  assert.equal(codeOf(twice), "cod_mismatch")
  assert.match(twice.kind === "kept" ? twice.reason : "", /pay twice/)
})

test("kept: demo orders, unmapped deliveries and refusals keep only our keys", () => {
  for (const r of [keptWithoutProvider(OWN, "demo"), keptWithoutProvider(OWN, "no_option"), refused(OWN, "Paczkomat XYZ01M does not exist.")]) {
    assert.equal(r.kind, "kept")
    assert.deepEqual(r.data, OWN)
  }
  const r = refused(OWN, "Paczkomat XYZ01M does not exist.")
  assert.match(r.kind === "kept" ? r.reason : "", /refused.*XYZ01M/)
})
