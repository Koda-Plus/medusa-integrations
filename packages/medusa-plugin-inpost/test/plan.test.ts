/**
 * The plan and the exact ShipX request it turns into, for each of the four
 * options: the receiver, the locker or the address, the parcel, cash on
 * delivery with insurance, the reference, the sender, the courier pickup, the
 * problems that stop a create and the hash a person confirms.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions, type InpostPluginOptions } from "../src/modules/inpost/lib/options.ts"
import { buildPlan, canonicalJson, parcelWeight, type PlanOrder, type PlanRow } from "../src/modules/inpost/lib/plan.ts"
import { effectiveSettings } from "../src/modules/inpost/lib/settings.ts"
import { order } from "./helpers.ts"

const LOCKER = { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa", city: "Warszawa", post_code: "00-950" }

function row(over: Partial<PlanRow> = {}): PlanRow {
  return {
    id: "inpar_1",
    order_id: "order_01KODASUPPLY000000000001",
    fulfillment_id: "ful_1",
    kind: "locker",
    cod: false,
    service: "inpost_locker_standard",
    locker_code: "KSP01M",
    locker_name: "Paczkomat KSP01M",
    locker_address: LOCKER,
    parcel_size: "small",
    parcel_no: 1,
    demo: false,
    items: null,
    ...over,
  }
}

const courier = (over: Partial<PlanRow> = {}) => row({ kind: "courier", service: "inpost_courier_standard", locker_code: null, locker_name: null, locker_address: null, ...over })

function ctx(options: InpostPluginOptions = {}, stored: Record<string, unknown> | null = null, demo = false) {
  const o = resolveOptions({ apiToken: "x".repeat(50), organizationId: "1", ...options })
  return { options: o, settings: effectiveSettings(o, stored as never), demo }
}

test("locker: target_point, one template parcel with its weight, receiver phone and e-mail, no address, no sender", () => {
  const p = buildPlan(row(), order() as PlanOrder, ctx())
  assert.equal(p.ok, true)
  assert.deepEqual(p.request, {
    service: "inpost_locker_standard",
    reference: "Order 1042",
    receiver: { first_name: "Anna", last_name: "Nowak", email: "anna.nowak@example.com", phone: "000000001" },
    parcels: [{ id: "1", template: "small", weight: { amount: 1.2, unit: "kg" } }],
    custom_attributes: { target_point: "KSP01M" },
  })
  assert.equal(p.cod, null)
  assert.ok(p.warnings.some((w) => w.code === "sender_organization"))
})

test("locker with cash on delivery: the exact order total as cod and insurance", () => {
  const p = buildPlan(row({ cod: true }), order({ total: 1565.0043 }) as PlanOrder, ctx())
  assert.equal(p.ok, true)
  assert.deepEqual(p.request?.cod, { amount: 1565, currency: "PLN" })
  assert.deepEqual(p.request?.insurance, { amount: 1565, currency: "PLN" })
  assert.equal(p.cod?.amount, "1565.00")
  assert.equal(p.cod?.minor, 156500)
})

test("courier: the address split into street, building and flat, dimensions of the size, a 00-000 post code", () => {
  const p = buildPlan(courier({ parcel_size: "medium" }), order() as PlanOrder, ctx())
  assert.equal(p.ok, true)
  assert.deepEqual(p.request?.receiver.address, { street: "ul. Przykładowa", building_number: "5", flat_number: "2", city: "Warszawa", post_code: "00-950", country_code: "PL" })
  assert.deepEqual(p.request?.parcels, [{ id: "1", dimensions: { length: 640, width: 380, height: 190, unit: "mm" }, weight: { amount: 1.2, unit: "kg" }, is_non_standard: false }])
  assert.equal(p.request?.custom_attributes, undefined, "a courier shipment has no target point")
})

test("courier with cash on delivery: insurance required by ShipX, equal to the amount, 1.005 rounds half up", () => {
  const p = buildPlan(courier({ cod: true }), order({ total: 1.005 }) as PlanOrder, ctx())
  assert.deepEqual(p.request?.cod, { amount: 1.01, currency: "PLN" })
  assert.deepEqual(p.request?.insurance, { amount: 1.01, currency: "PLN" })
  const exact = buildPlan(courier({ cod: true }), order({ total: "249.90" }) as PlanOrder, ctx())
  assert.equal(JSON.stringify(exact.request?.cod), '{"amount":249.9,"currency":"PLN"}')
})

test("cash on delivery needs PLN, a known total above zero; a paid order is a warning", () => {
  assert.deepEqual(buildPlan(row({ cod: true }), order({ currency_code: "eur" }) as PlanOrder, ctx()).problems.map((x) => x.code), ["cod_currency"])
  assert.deepEqual(buildPlan(row({ cod: true }), order({ total: 0 }) as PlanOrder, ctx()).problems.map((x) => x.code), ["cod_zero"])
  assert.deepEqual(buildPlan(row({ cod: true }), order({ total: undefined }) as PlanOrder, ctx()).problems.map((x) => x.code), ["cod_amount_unknown"])
  const paid = buildPlan(row({ cod: true }), order({ payment_collections: [{ captured_amount: 199.99 }] }) as PlanOrder, ctx())
  assert.equal(paid.ok, true)
  assert.ok(paid.warnings.some((w) => w.code === "order_paid"))
})

test("problems stop the request: locker, phone, e-mail, name, address, country, canceled order, shipped outside", () => {
  const codes = (r: PlanRow, o: Record<string, unknown>, c = ctx()) => buildPlan(r, o as PlanOrder, c).problems.map((x) => x.code)
  assert.deepEqual(codes(row({ locker_code: null }), order()), ["locker_missing"])
  assert.deepEqual(codes(row({ locker_code: "KRA 01" }), order()), ["locker_invalid"])
  assert.deepEqual(codes(row(), order({ shipping_address: { ...order().shipping_address, phone: "123" } })), ["phone_invalid"])
  assert.deepEqual(codes(row(), order({ shipping_address: { ...order().shipping_address, phone: null } })), ["phone_missing"])
  assert.deepEqual(codes(row(), order({ email: "", customer: null })), ["email_missing"])
  assert.deepEqual(codes(courier(), order({ shipping_address: { ...order().shipping_address, first_name: "", company: "" } })), ["name_missing"])
  assert.deepEqual(codes(courier(), order({ shipping_address: { ...order().shipping_address, address_1: "ul. Bez Numeru", address_2: "" } })), ["address_no_building"])
  assert.deepEqual(codes(courier(), order({ shipping_address: { ...order().shipping_address, country_code: "de", postal_code: "10115" } })), ["country_unsupported", "post_code_invalid"])
  assert.deepEqual(codes(courier(), order({ shipping_address: { ...order().shipping_address, postal_code: "" } })), ["post_code_missing"])
  assert.deepEqual(codes(courier(), order({ shipping_address: { ...order().shipping_address, postal_code: "00950" } })), [], "a postal code without its hyphen is normalized, not refused")
  const personal = buildPlan(courier(), order({ shipping_address: { ...order().shipping_address, phone: "123", address_1: "ul. Bez Numeru", address_2: "", postal_code: "1234" } }) as PlanOrder, ctx()).problems
  assert.deepEqual(personal.map((p) => p.code), ["phone_invalid", "address_no_building", "post_code_invalid"])
  assert.ok(personal.every((p) => p.detail === undefined), "problems are stored on the row: they never carry the receiver's data")
  assert.deepEqual(codes(row(), order({ status: "canceled" })), ["order_canceled"])
  assert.deepEqual(codes(row(), order({ metadata: { inpost_shipment: { shipment_id: 1 } } }), ctx({ skipMetadataKeys: ["inpost_shipment"] })), ["shipped_outside"])
  assert.deepEqual(codes(row({ fulfillment_canceled_at: new Date() }), order()), ["fulfillment_canceled"])
  assert.equal(buildPlan(row(), null, ctx()).problems[0].code, "order_missing")
  assert.equal(buildPlan(row({ locker_code: null }), order() as PlanOrder, ctx()).request, null)
})

test("a company receiver is enough for a courier; the e-mail of the customer when the order has none", () => {
  const p = buildPlan(courier(), order({ email: null, shipping_address: { ...order().shipping_address, first_name: "", last_name: "", company: "Koda Supply sp. z o.o." } }) as PlanOrder, ctx())
  assert.equal(p.ok, true)
  assert.equal(p.request?.receiver.company_name, "Koda Supply sp. z o.o.")
  assert.equal(p.request?.receiver.email, "anna.nowak@example.com")
})

test("the weight: variants in grams by default, kg on request; unknown weights take the default and say so; too heavy stops", () => {
  const o = order() as PlanOrder
  assert.deepEqual(parcelWeight(o, null, "g", 1), { kg: 1.2, estimated: false })
  assert.deepEqual(parcelWeight(o, [{ line_item_id: "ordli_2", quantity: 1 }], "g", 1), { kg: 0.3, estimated: false })
  assert.deepEqual(parcelWeight({ ...o, items: [{ id: "a", quantity: 1, variant: { weight: 2 } }] }, null, "kg", 1), { kg: 2, estimated: false })
  assert.deepEqual(parcelWeight({ ...o, items: [{ id: "a", quantity: 1, variant: null }] }, null, "g", 1.5), { kg: 1.5, estimated: true })
  const heavy = buildPlan(row(), { ...o, items: [{ id: "ordli_1", quantity: 1, variant: { weight: 26_000 } }] }, ctx())
  assert.deepEqual(heavy.problems.map((x) => x.code), ["too_heavy"])
  const estimated = buildPlan(row(), { ...o, items: [] }, ctx({ defaultWeightKg: 2 }))
  assert.ok(estimated.warnings.some((w) => w.code === "weight_estimated"))
  assert.equal(estimated.request?.parcels[0].weight.amount, 2)
})

test("the size: the row's, else the default of Settings (admin over option), with a warning", () => {
  const p = buildPlan(row({ parcel_size: null }), order() as PlanOrder, ctx({ defaultParcelSize: "C" }))
  assert.equal(p.parcel.size, "large")
  assert.equal(p.parcel.letter, "C")
  assert.ok(p.warnings.some((w) => w.code === "parcel_size_default"))
  const admin = buildPlan(row({ parcel_size: null }), order() as PlanOrder, ctx({ defaultParcelSize: "C" }, { defaultParcelSize: "small" }))
  assert.equal(admin.parcel.size, "small")
})

test("the reference: the template, a /n suffix for the second parcel of an order, never shorter than 3", () => {
  assert.equal(buildPlan(row({ parcel_no: 2 }), order() as PlanOrder, ctx()).reference, "Order 1042/2")
  assert.equal(buildPlan(row(), order() as PlanOrder, ctx({ referenceTemplate: "Zamówienie {display_id}" })).reference, "Zamówienie 1042")
  assert.equal(buildPlan(row(), order({ display_id: 7 }) as PlanOrder, ctx({ referenceTemplate: "{display_id}" })).reference, "##7")
})

test("the sender goes only with an e-mail and a phone; its address too when complete", () => {
  const none = buildPlan(row(), order() as PlanOrder, ctx({ sender: { companyName: "Koda Supply" } }))
  assert.equal(none.request?.sender, undefined)
  const s = { companyName: "Koda Supply", email: "sklep@example.com", phone: "000 000 002", street: "ul. Magazynowa", buildingNumber: "1", city: "Warszawa", postCode: "00001" }
  const p = buildPlan(row(), order() as PlanOrder, ctx({ sender: s }))
  assert.deepEqual(p.request?.sender, { company_name: "Koda Supply", email: "sklep@example.com", phone: "000000002", address: { street: "ul. Magazynowa", building_number: "1", city: "Warszawa", post_code: "00-001", country_code: "PL" } })
})

test("sending methods: the kind's method, a drop-off locker with parcel_locker, a courier pickup that needs the sender's address", () => {
  const p = buildPlan(row(), order() as PlanOrder, ctx({ sendingMethod: { locker: "parcel_locker" }, dropoffPoint: "ksp05g" }))
  assert.deepEqual(p.request?.custom_attributes, { target_point: "KSP01M", sending_method: "parcel_locker", dropoff_point: "KSP05G" })
  const noSender = buildPlan(courier(), order() as PlanOrder, ctx({ sendingMethod: { courier: "dispatch_order" } }))
  assert.deepEqual(noSender.problems.map((x) => x.code), ["pickup_sender_missing"])
  const sender = { companyName: "Koda Supply", email: "sklep@example.com", phone: "000000002", street: "ul. Magazynowa", buildingNumber: "1", city: "Warszawa", postCode: "00-001" }
  const ok = buildPlan(courier(), order() as PlanOrder, ctx({ sendingMethod: { courier: "dispatch_order" }, sender }))
  assert.equal(ok.ok, true)
  assert.equal(ok.request?.custom_attributes?.sending_method, "dispatch_order")
  assert.equal(ok.pickup?.address.street, "ul. Magazynowa")
})

test("demo mode fills a missing phone and e-mail with marked samples, live mode never does", () => {
  const bare = order({ email: null, customer: null, shipping_address: { ...order().shipping_address, phone: null } }) as PlanOrder
  const demo = buildPlan(row(), bare, ctx({}, null, true))
  assert.equal(demo.ok, true)
  assert.equal(demo.receiver.sample, true)
  assert.ok(demo.warnings.some((w) => w.code === "sample_contact"))
  assert.equal(buildPlan(row(), bare, ctx()).ok, false)
})

test("the hash: the same for the same plan, another when anything sent would change", () => {
  const a = buildPlan(row(), order() as PlanOrder, ctx())
  const b = buildPlan(row(), order() as PlanOrder, ctx())
  assert.equal(a.hash, b.hash)
  assert.match(a.hash, /^[0-9a-f]{24}$/)
  assert.notEqual(buildPlan(row({ locker_code: "KSP02A" }), order() as PlanOrder, ctx()).hash, a.hash)
  assert.notEqual(buildPlan(row(), order({ shipping_address: { ...order().shipping_address, phone: "000000009" } }) as PlanOrder, ctx()).hash, a.hash)
  assert.notEqual(buildPlan(row({ id: "inpar_2" }), order() as PlanOrder, ctx()).hash, a.hash, "two shipments never share a hash")
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}')
})
