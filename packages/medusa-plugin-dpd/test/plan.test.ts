/**
 * The plan and the exact generatePackagesNumbers request (spec 5.1.5 to
 * 5.1.7, 7.1, 7.2): the receiver from the shipping address (Polish postal
 * codes as five digits, phones without +48), the sender of the stock
 * location or of demo mode, the boxes from the variant weights or by hand,
 * cash on delivery to the cent, every problem collected, the request only
 * without problems, and a hash that follows every byte of the request.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { boxesForPlan, boxProblems, parseBoxesInput, readStoredBoxes, roundKg, variantWeightKg, type StoredBoxes } from "../src/modules/dpd/lib/boxes.ts"
import { capturedMinor, codFor, onlinePaymentProviders, orderTotalMinor } from "../src/modules/dpd/lib/cod.ts"
import { MAX_BOXES } from "../src/modules/dpd/lib/constants.ts"
import { DEMO_SENDER } from "../src/modules/dpd/lib/demo.ts"
import { resolveOptions, type DpdPluginOptions } from "../src/modules/dpd/lib/options.ts"
import { labelFileName, pdfText, simpleLabelPdf } from "../src/modules/dpd/lib/pdf.ts"
import {
  buildPlan,
  canonicalJson,
  parcelReference,
  PLAN_ORDER_FIELDS,
  PLAN_PROBLEM_CODES,
  PLAN_WARNING_CODES,
  planHash,
  receiverOf,
  senderOf,
  type PlanOrder,
  type PlanRow,
} from "../src/modules/dpd/lib/plan.ts"
import { validateSender } from "../src/modules/dpd/lib/sender.ts"

const SENDER = {
  company: "Koda Supply",
  name: "Anna Nowak",
  phone: "+48 000 000 001",
  email: "shop@example.com",
  street: "ul. Przykładowa 5",
  city: "Warszawa",
  postalCode: "00-950",
}

const BASE: DpdPluginOptions = { login: "koda-test", password: "test-password-koda-0000", masterFid: "1000", sender: SENDER }

const opts = (extra: DpdPluginOptions = {}) => resolveOptions({ ...BASE, ...extra })

function order(extra: Partial<PlanOrder> = {}): PlanOrder {
  return {
    id: "order_01ABC",
    display_id: 1042,
    status: "pending",
    email: "anna@example.com",
    currency_code: "pln",
    total: 249.9,
    shipping_address: {
      first_name: "Anna",
      last_name: "Przykładowa",
      company: "",
      address_1: "ul. Długa 2",
      address_2: "m. 4",
      city: "Kraków",
      postal_code: "30-001",
      country_code: "pl",
      phone: "+48 600 100 200",
    },
    items: [
      { id: "item_1", quantity: 2, variant: { weight: 500 } },
      { id: "item_2", quantity: 1, variant: { weight: 250 } },
    ],
    payment_collections: [{ captured_amount: 0, payments: [{ provider_id: "pp_system_default", canceled_at: null }] }],
    ...extra,
  }
}

function address(extra: Record<string, unknown>): PlanOrder["shipping_address"] {
  return { ...order().shipping_address, ...extra }
}

function row(extra: Partial<PlanRow> = {}): PlanRow {
  return {
    id: "dpdshp_01",
    kind: "outbound",
    optionId: "dpd-courier-cod",
    pudoId: null,
    reference: "ful_01ABC",
    boxes: null,
    fulfillment: { id: "ful_01ABC", canceledAt: null, shippedAt: null, deliveredAt: null, locationId: null, items: null },
    ...extra,
  }
}

const plan = (r: PlanRow = row(), o: PlanOrder | null = order(), options = opts(), demo = false, codCarrier?: boolean) => buildPlan(r, o, { options, demo, codCarrier })
const codes = (list: Array<{ code: string }>) => list.map((p) => p.code)

test("field by field: the exact request for DPD", () => {
  const p = plan()
  assert.deepEqual(p.problems, [])
  assert.equal(p.ok, true)
  assert.deepEqual(p.request, {
    generationPolicy: "STOP_ON_FIRST_ERROR",
    packages: [
      {
        reference: "ful_01ABC",
        ref1: "1042",
        ref2: "order_01ABC",
        sender: { company: "Koda Supply", name: "Anna Nowak", address: "ul. Przykładowa 5", city: "Warszawa", countryCode: "PL", postalCode: "00950", phone: "000000001", email: "shop@example.com" },
        receiver: { name: "Anna Przykładowa", address: "ul. Długa 2 m. 4", city: "Kraków", countryCode: "PL", postalCode: "30001", phone: "600100200", email: "anna@example.com" },
        payerFID: 1000,
        parcels: [{ reference: "ful_01ABC-1", weight: 1.25 }],
        services: [{ code: "COD", attributes: [{ code: "AMOUNT", value: "249.90" }, { code: "CURRENCY", value: "PLN" }] }],
      },
    ],
  })
  assert.equal(p.kind, "courier")
  assert.equal(p.cod, true)
  assert.equal(p.sessionType, "DOMESTIC")
  assert.equal(p.country, "PL")
  assert.equal(p.reference, "ful_01ABC")
  assert.deepEqual(p.parcelReferences, ["ful_01ABC-1"])
  assert.deepEqual(p.codDue, { minor: 24990, amount: "249.90", currency: "PLN" })
  assert.equal(p.boxesSource, "variants")
  assert.deepEqual(p.boxes, [{ weightKg: 1.25, lengthCm: null, widthCm: null, heightCm: null }])
  assert.match(p.hash, /^[0-9a-f]{24}$/)
  assert.equal(p.hash, planHash({ request: p.request, rowId: "dpdshp_01" }))
  /* The payer FID of the options, the payer FID of demo mode. */
  assert.equal(plan(row(), order(), opts({ payerFid: "2000" })).request?.packages[0].payerFID, 2000)
})

test("no payer FID outside demo mode: payer_fid_missing, never a request with payerFID 0", () => {
  const none = plan(row(), order(), resolveOptions({ ...BASE, masterFid: undefined }))
  assert.equal(none.ok, false)
  assert.equal(none.request, null)
  assert.deepEqual(none.problems, [{ code: "payer_fid_missing", field: "payerFid" }])
  assert.equal(plan(row(), order(), resolveOptions({ ...BASE, masterFid: undefined, payerFid: "2000" })).request?.packages[0].payerFID, 2000, "payerFid alone is enough")
})

test("receiver: five digit postal codes, the phone without +48, no phone a warning, empty fields left out", () => {
  const r = receiverOf(order({ shipping_address: address({ postal_code: "00-950", phone: "" }), email: null, customer: { email: "c@example.com" } }))
  assert.equal(r.receiver?.postalCode, "00950")
  assert.equal(r.receiver?.phone, undefined)
  assert.equal(r.receiver?.email, "c@example.com", "the customer e-mail when the order has none")
  assert.equal(r.receiver?.company, undefined, "an empty company is left out, never sent as an empty string")
  assert.deepEqual(codes(r.warnings), ["receiver_phone_missing"])
  assert.equal(receiverOf(order()).receiver?.phone, "600100200")
  const bad = receiverOf(order({ shipping_address: address({ phone: "12" }), email: "not an e-mail" }))
  assert.equal(bad.receiver?.phone, undefined)
  assert.equal(bad.receiver?.email, undefined)
  assert.deepEqual(codes(bad.warnings), ["receiver_phone_invalid"])
  const company = receiverOf(order({ shipping_address: address({ first_name: "", last_name: "", company: "Firma Testowa" }) }))
  assert.equal(company.receiver?.company, "Firma Testowa")
  assert.equal(company.receiver?.name, undefined)
  assert.deepEqual(company.problems, [])
  const nobody = receiverOf(order({ shipping_address: address({ first_name: " ", last_name: null, company: null }) }))
  assert.deepEqual(codes(nobody.problems), ["receiver_name_missing"])
  const holes = receiverOf(order({ shipping_address: address({ address_1: "", city: "", postal_code: "", country_code: "" }) }))
  assert.deepEqual(holes.problems.map((p) => p.field), ["receiver.address", "receiver.city", "receiver.countryCode", "receiver.postalCode"])
  assert.deepEqual(receiverOf(order({ shipping_address: address({ postal_code: "3000" }) })).problems, [{ code: "address_incomplete", field: "receiver.postalCode" }])
  assert.deepEqual(codes(receiverOf(order({ shipping_address: null })).problems), ["address_incomplete"])
  /* A phone for a warning only: the plan stays ok without it (DS9). */
  const noPhone = plan(row(), order({ shipping_address: address({ phone: null }) }))
  assert.equal(noPhone.ok, true)
  assert.deepEqual(codes(noPhone.warnings), ["receiver_phone_missing"])
})

test("a long address is a problem with its field and limit, never cut", () => {
  const long = "x".repeat(101)
  const p = plan(row(), order({ shipping_address: address({ address_1: long, address_2: "", city: "y".repeat(51) }) }))
  assert.deepEqual(p.problems, [
    { code: "receiver_too_long", field: "receiver.address", detail: "receiver.address, max 100" },
    { code: "receiver_too_long", field: "receiver.city", detail: "receiver.city, max 50" },
  ])
  assert.equal(p.receiver?.address, long, "kept as typed")
  assert.equal(p.request, null)
  assert.equal(p.ok, false)
})

test("cash on delivery: formatMinor, float noise, partly captured, paid online, zero, no total, EUR in Poland", () => {
  assert.equal(plan(row(), order({ total: 1565.0043 })).codDue?.amount, "1565.00")
  assert.equal(plan(row(), order({ total: 1.005 })).codDue?.amount, "1.01")
  assert.equal(plan(row(), order({ summary: { raw_current_order_total: { value: "300.10" } }, total: 1 })).codDue?.amount, "300.10", "the summary first")
  const partly = plan(row(), order({ payment_collections: [{ captured_amount: 49.9, payments: [{ provider_id: "pp_system_default", canceled_at: null }] }] }))
  assert.equal(partly.codDue?.amount, "200.00")
  assert.deepEqual(partly.warnings, [{ code: "order_paid", detail: "49.90", amount: { minor: 4990, currency: "PLN" } }], "the captured amount for the admin to format")
  const online = plan(row(), order({ payment_collections: [{ captured_amount: 0, payments: [{ provider_id: "pp_stripe_stripe", canceled_at: null }, { provider_id: "pp_przelewy", canceled_at: "2026-11-01" }] }] }))
  assert.deepEqual(online.problems, [{ code: "cod_paid_online", detail: "pp_stripe_stripe" }])
  assert.equal(online.request, null)
  const zero = plan(row(), order({ payment_collections: [{ captured_amount: 249.9, payments: [{ provider_id: "pp_system_default" }] }] }))
  assert.deepEqual(codes(zero.problems), ["cod_zero"])
  assert.deepEqual(codes(plan(row(), order({ total: undefined })).problems), ["cod_amount_unknown"])
  assert.deepEqual(plan(row(), order({ currency_code: "eur" })).problems, [{ code: "cod_currency_unsupported", detail: "EUR" }])
  /* Even when codCountries lets EUR in for Poland, domestic COD stays PLN (S10). */
  assert.deepEqual(codes(plan(row(), order({ currency_code: "eur" }), opts({ codCountries: { PL: ["PLN", "EUR"] } })).problems), ["cod_currency_unsupported"])
  assert.deepEqual(codes(plan(row(), order(), opts({ codCountries: "{}" })).problems), ["cod_country_unsupported"])
  /* Without the COD option, no services key at all. */
  const plain = plan(row({ optionId: "dpd-courier" }))
  assert.equal(plain.ok, true)
  assert.equal(plain.codDue, null)
  assert.equal(plain.cod, false)
  assert.ok(plain.request && !("services" in plain.request.packages[0]))
})

test("cash on delivery on another shipment of the order: no services, a warning", () => {
  const other = plan(row(), order(), opts(), false, false)
  assert.equal(other.ok, true)
  assert.equal(other.codDue, null)
  assert.ok(other.request && !("services" in other.request.packages[0]))
  assert.deepEqual(codes(other.warnings), ["cod_on_other_parcel"])
  assert.notEqual(other.hash, plan().hash)
})

test("the cod helpers on their own", () => {
  assert.equal(orderTotalMinor(order({ summary: { current_order_total: "12.34" }, total: 99 })), 1234)
  assert.equal(orderTotalMinor(order({ total: null })), null)
  assert.equal(capturedMinor(null), 0)
  assert.equal(capturedMinor(order({ payment_collections: [{ captured_amount: "10.5" }, null, { captured_amount: { value: "0.25" } }] })), 1075)
  assert.deepEqual(onlinePaymentProviders(order({ payment_collections: [{ payments: [{ provider_id: "pp_a" }, { provider_id: "pp_a" }, null, { provider_id: "pp_system_default" }] }] }), ["pp_system_default"]), ["pp_a"])
  const options = { codCountries: { PL: ["PLN" as const] }, codPaymentProviders: ["pp_system_default"] }
  assert.deepEqual(codFor({ optionCod: false, country: "PL", order: order(), options }), { cod: null, problems: [], warnings: [] })
  assert.deepEqual(codFor({ optionCod: true, country: null, order: order(), options }).problems, [{ code: "cod_country_unsupported" }])
  assert.equal(codFor({ optionCod: true, country: "PL", order: order(), options }).cod?.amount, "249.90", "carrier undefined reads as true")
})

test("boxes: variant weights in g and kg with quantities, rounded up to 0.01, at least 0.01", () => {
  assert.deepEqual(variantWeightKg(order(), null, "g"), { kg: 1.25, complete: true })
  assert.deepEqual(variantWeightKg(order(), null, "kg"), { kg: 1250, complete: true })
  assert.deepEqual(variantWeightKg(order(), [{ line_item_id: "item_1", quantity: 1 }], "g"), { kg: 0.5, complete: true }, "only the fulfilled items")
  assert.equal(variantWeightKg(order(), [{ line_item_id: "item_gone", quantity: 1 }], "g").complete, false)
  assert.equal(variantWeightKg(order({ items: [] }), null, "g").complete, false)
  assert.equal(roundKg(1.2), 1.2)
  assert.equal(roundKg(1.231), 1.24)
  assert.equal(roundKg(0.0043), 0.01)
  assert.equal(roundKg(0), 0.01)
  assert.equal(roundKg(Number.NaN), 0.01)
  const tiny = plan(row({ optionId: "dpd-courier" }), order({ items: [{ id: "item_1", quantity: 1, variant: { weight: 3 } }] }))
  assert.equal(tiny.request?.packages[0].parcels[0].weight, 0.01)
  const odd = plan(row({ optionId: "dpd-courier" }), order({ items: [{ id: "item_1", quantity: 3, variant: { weight: "333.4" } }] }))
  assert.equal(odd.request?.packages[0].parcels[0].weight, 1.01)
})

test("boxes: no weight uses the default box (warning) or asks for one (problem); its sides go to DPD as whole cm", () => {
  const noWeight = order({ items: [{ id: "item_1", quantity: 1, variant: { weight: null } }, { id: "item_2", quantity: 1, variant: { weight: 400 } }] })
  const missing = plan(row({ optionId: "dpd-courier" }), noWeight)
  assert.deepEqual(codes(missing.problems), ["weight_missing"])
  assert.equal(missing.boxesSource, "none")
  assert.deepEqual(missing.boxes, [])
  assert.equal(missing.request, null)
  const boxed = plan(row({ optionId: "dpd-courier" }), noWeight, opts({ defaultBox: { weightKg: 2, lengthCm: 40, widthCm: 30, heightCm: 20 } }))
  assert.equal(boxed.boxesSource, "default_box")
  assert.deepEqual(codes(boxed.warnings), ["weight_default_box"])
  assert.deepEqual(boxed.request?.packages[0].parcels, [{ reference: "ful_01ABC-1", weight: 2, sizeX: 40, sizeY: 30, sizeZ: 20 }])
  const heavier = plan(row({ optionId: "dpd-courier" }), order({ items: [{ id: "item_1", quantity: 1, variant: { weight: 5000 } }, { id: "item_2", quantity: 1 }] }), opts({ defaultBox: { weightKg: 2 } }))
  assert.equal(heavier.boxes[0].weightKg, 5, "the known weight when it exceeds the default box")
  const sides = plan(row({ optionId: "dpd-courier" }), order(), opts({ defaultBox: { weightKg: 2, lengthCm: 40 } }))
  assert.equal(sides.boxesSource, "variants")
  assert.deepEqual(sides.request?.packages[0].parcels, [{ reference: "ful_01ABC-1", weight: 1.25, sizeX: 40 }])
})

test("boxes set by hand: used as they are, each with its reference; limits and 101 boxes are problems", () => {
  const stored: StoredBoxes = {
    edited: true,
    items: [
      { weightKg: 1.5, lengthCm: 30, widthCm: 20, heightCm: 10, reference: null, waybill: null },
      { weightKg: 60, lengthCm: null, widthCm: null, heightCm: null, reference: null, waybill: null },
    ],
  }
  const p = plan(row({ optionId: "dpd-courier", boxes: stored }))
  assert.equal(p.boxesSource, "edited")
  assert.deepEqual(p.parcelReferences, ["ful_01ABC-1", "ful_01ABC-2"])
  assert.deepEqual(p.request?.packages[0].parcels, [
    { reference: "ful_01ABC-1", weight: 1.5, sizeX: 30, sizeY: 20, sizeZ: 10 },
    { reference: "ful_01ABC-2", weight: 60 },
  ])
  assert.deepEqual(p.warnings, [{ code: "courier_over_50kg", field: "boxes[1].weightKg" }], "over 50 kg warns, never blocks (S11)")
  const invalid = plan(row({ boxes: { edited: true, items: [{ weightKg: 701, lengthCm: 0, widthCm: 20.5, heightCm: 301, reference: null, waybill: null }] } }))
  assert.deepEqual(invalid.problems.map((x) => `${x.code} ${x.field}`), ["box_invalid boxes[0].weightKg", "box_invalid boxes[0].lengthCm", "box_invalid boxes[0].widthCm", "box_invalid boxes[0].heightCm"])
  const many = Array.from({ length: MAX_BOXES + 1 }, () => ({ weightKg: 1, lengthCm: null, widthCm: null, heightCm: null }))
  assert.deepEqual(codes(boxProblems(many)), ["too_many_boxes"])
  const automatic = boxesForPlan({ boxes: { edited: false, items: stored.items }, fulfillment: null }, order(), { weightUnit: "g", defaultBox: null })
  assert.equal(automatic.source, "variants", "a snapshot that was not edited is recomputed")
})

test("parseBoxesInput and readStoredBoxes", () => {
  assert.deepEqual(parseBoxesInput([{ weightKg: "1,5", lengthCm: "30", widthCm: 20.4, heightCm: "" }]), { ok: true, boxes: [{ weightKg: 1.5, lengthCm: 30, widthCm: 20, heightCm: null }] })
  assert.deepEqual(parseBoxesInput({ boxes: [{ weightKg: 0.004 }] }), { ok: false, errors: ["boxes[0].weightKg"], fields: [{ index: 0, field: "weightKg" }] })
  assert.deepEqual(parseBoxesInput([{ weightKg: 1 }, { weightKg: "x", heightCm: 500 }, "nope"]), {
    ok: false,
    errors: ["boxes[1].weightKg", "boxes[1].heightCm", "boxes[2]"],
    fields: [
      { index: 1, field: "weightKg" },
      { index: 1, field: "heightCm" },
      { index: 2, field: "weightKg" },
    ],
  })
  assert.deepEqual(parseBoxesInput([]), { ok: false, errors: [`boxes (1 to ${MAX_BOXES})`], fields: [] })
  assert.equal(parseBoxesInput(Array.from({ length: MAX_BOXES + 1 }, () => ({ weightKg: 1 }))).ok, false)
  assert.deepEqual(parseBoxesInput("boxes"), { ok: false, errors: ["boxes"], fields: [] })
  const stored = { edited: true, items: [{ weightKg: 2, lengthCm: 10, widthCm: null, heightCm: null, reference: "ful_1-1", waybill: "0000899000001Q" }] }
  assert.deepEqual(readStoredBoxes(stored), stored)
  assert.deepEqual(readStoredBoxes(JSON.stringify(stored)), stored)
  assert.equal(readStoredBoxes({ edited: "yes", items: [] }), null)
  assert.equal(readStoredBoxes({ edited: true, items: [{ weightKg: "2" }] }), null)
  assert.equal(readStoredBoxes(null), null)
  assert.equal(readStoredBoxes("{broken"), null)
})

test("Pickup options and returns come later; an address abroad too; an unknown option is a problem", () => {
  for (const optionId of ["dpd-pickup", "dpd-pickup-cod", "dpd-return"]) {
    const p = plan(row({ optionId }))
    assert.deepEqual(codes(p.problems), ["option_later"], optionId)
    assert.equal(p.request, null)
    assert.equal(p.receiver, null, "nothing more is read")
  }
  assert.deepEqual(codes(plan(row({ kind: "return", optionId: "dpd-courier" })).problems), ["option_later"])
  const abroad = plan(row({ optionId: "dpd-courier" }), order({ shipping_address: address({ country_code: "de", postal_code: "10115", phone: "+49 30 1234567" }) }))
  assert.deepEqual(abroad.problems, [{ code: "abroad_later", detail: "DE" }])
  assert.equal(abroad.sessionType, "INTERNATIONAL")
  assert.deepEqual(codes(plan(row({ optionId: "dpd-courier" }), order(), opts({ countries: "DE" })).problems), ["country_unsupported"])
  assert.deepEqual(plan(row({ optionId: "dpd-anything" })).problems, [{ code: "option_unknown", detail: "dpd-anything" }])
})

test("order and fulfillment states are problems, all of them collected", () => {
  assert.deepEqual(codes(plan(row(), null).problems), ["order_missing"])
  assert.deepEqual(codes(plan(row(), order({ status: "canceled" })).problems), ["order_canceled"])
  const f = plan(row({ fulfillment: { id: "ful_01ABC", canceledAt: "2026-11-01", shippedAt: new Date(), deliveredAt: "2026-11-02", locationId: null, items: null } }))
  assert.deepEqual(codes(f.problems), ["fulfillment_canceled", "fulfillment_shipped", "fulfillment_delivered"])
  const many = plan(row(), order({ status: "canceled", currency_code: "usd", shipping_address: address({ city: "" }) }), opts({ sender: "" }))
  assert.deepEqual(codes(many.problems), ["order_canceled", "address_incomplete", "sender_missing", "cod_currency_unsupported"])
  assert.equal(many.request, null)
})

test("sender: the stock location's own sender, demo's sample sender, the problems of a broken one", () => {
  const options = opts({ senders: { sloc_02: { ...SENDER, company: "Magazyn Kraków", city: "Kraków", postalCode: "30-001" } } })
  const p = plan(row({ fulfillment: { id: "ful_01ABC", canceledAt: null, shippedAt: null, deliveredAt: null, locationId: "sloc_02", items: null } }), order(), options)
  assert.equal(p.senderLocationId, "sloc_02")
  assert.equal(p.sender?.company, "Magazyn Kraków")
  assert.equal(p.request?.packages[0].sender.postalCode, "30001")
  assert.equal(plan(row(), order(), options).senderLocationId, null, "the main sender for another location")
  const demo = plan(row(), order(), resolveOptions({ demo: true }), true)
  assert.equal(demo.ok, true)
  assert.deepEqual(codes(demo.warnings), ["sample_sender"])
  assert.equal(demo.request?.packages[0].payerFID, 1)
  assert.equal(demo.request?.packages[0].sender.company, "Sample Store")
  assert.deepEqual(validateSender(DEMO_SENDER), [], "the sample sender passes the strictest checks")
  const missing = senderOf(resolveOptions({}), null, false)
  assert.deepEqual(missing, { sender: null, problems: [{ code: "sender_missing", field: "sender" }], warnings: [] })
  const broken = senderOf(opts({ sender: { ...SENDER, street: "", phone: "12", city: "z".repeat(40) } }), null, false)
  assert.deepEqual(broken.problems, [
    { code: "sender_invalid", field: "sender.street", detail: "sender.street, required" },
    { code: "sender_invalid", field: "sender.city", detail: "sender.city, too long, max 35" },
    { code: "sender_invalid", field: "sender.phone", detail: "sender.phone, invalid" },
  ])
})

test("the reference: the fulfillment id, else the row id (E6); room for the box suffix", () => {
  assert.equal(plan(row({ reference: null })).reference, "ful_01ABC")
  const seeded = plan(row({ reference: null, fulfillment: null }))
  assert.equal(seeded.reference, "dpdshp_01")
  assert.equal(seeded.request?.packages[0].reference, "dpdshp_01")
  assert.equal(seeded.request?.packages[0].parcels[0].reference, "dpdshp_01-1")
  assert.deepEqual(codes(plan(row({ reference: "f".repeat(47) })).problems), ["reference_too_long"])
  assert.equal(plan(row({ reference: "f".repeat(46) })).ok, true)
  assert.equal(parcelReference("ful_1", 3), "ful_1-3")
  /* No display id: ref1 left out. */
  assert.ok(!("ref1" in (plan(row(), order({ display_id: null })).request?.packages[0] ?? {})))
})

test("the hash: stable for the same request in any key order, changes with the address, phone, total and boxes, differs per row", () => {
  const base = plan()
  const reordered = order()
  const shuffled: PlanOrder = { payment_collections: reordered.payment_collections, items: reordered.items, shipping_address: reordered.shipping_address, total: reordered.total, currency_code: reordered.currency_code, email: reordered.email, status: reordered.status, display_id: reordered.display_id, id: reordered.id }
  assert.equal(plan(row(), shuffled).hash, base.hash)
  assert.equal(canonicalJson({ b: 1, a: [2, { d: undefined, c: 3 }] }), canonicalJson({ a: [2, { c: 3 }], b: 1 }))
  const changed = [
    plan(row(), order({ shipping_address: address({ address_2: "m. 5" }) })),
    plan(row(), order({ shipping_address: address({ phone: "+48 600 100 201" }) })),
    plan(row(), order({ total: 249.91 })),
    plan(row({ boxes: { edited: true, items: [{ weightKg: 1.25, lengthCm: 10, widthCm: null, heightCm: null, reference: null, waybill: null }] } })),
    plan(row({ id: "dpdshp_02" })),
  ]
  for (const p of changed) assert.notEqual(p.hash, base.hash)
  /* Warnings only (a missing phone vs an invalid one) change nothing sent, so nothing in the hash. */
  const missingPhone = plan(row(), order({ shipping_address: address({ phone: "" }) }))
  const invalidPhone = plan(row(), order({ shipping_address: address({ phone: "12" }) }))
  assert.equal(missingPhone.hash, invalidPhone.hash)
  assert.notDeepEqual(missingPhone.warnings, invalidPhone.warnings)
})

test("the codes and fields lists", () => {
  assert.equal(new Set(PLAN_PROBLEM_CODES).size, PLAN_PROBLEM_CODES.length)
  assert.equal(new Set(PLAN_WARNING_CODES).size, PLAN_WARNING_CODES.length)
  assert.ok(PLAN_ORDER_FIELDS.includes("summary"), "E15: summary, not summary.*")
  assert.ok(!PLAN_ORDER_FIELDS.includes("summary.*"))
  assert.equal(new Set(PLAN_ORDER_FIELDS).size, PLAN_ORDER_FIELDS.length)
})

test("the sample label: a PDF on the A4 and the label printer page, a safe file name", () => {
  const a4 = Buffer.from(simpleLabelPdf([{ text: "DPD by Koda Plus, sample label", bold: true, size: 14 }, { text: "Łódź (test)" }], "A4")).toString("latin1")
  assert.ok(a4.startsWith("%PDF-1.4"))
  assert.match(a4, /\/MediaBox \[0 0 595 842\]/)
  assert.match(a4, /\(Lodz \\\(test\\\)\) Tj/)
  assert.ok(a4.trimEnd().endsWith("%%EOF"))
  assert.match(Buffer.from(simpleLabelPdf([], "LBL_PRINTER")).toString("latin1"), /\/MediaBox \[0 0 288 432\]/)
  assert.equal(pdfText("zażółć"), "zazolc")
  assert.equal(labelFileName("1042", "0000899044445Q"), "dpd-label-1042-0000899044445Q.pdf")
  assert.equal(labelFileName("ful 01/ABC", null), "dpd-label-ful01ABC.pdf")
  assert.equal(labelFileName(null, null), "dpd-label.pdf")
})
