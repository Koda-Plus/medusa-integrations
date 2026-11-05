/**
 * The plan of a handover to the courier, pure (spec 5.1.5, 7.1 to 7.7):
 * which shipments may go (DS5), one sender per dispatch (DS9), the
 * packagesParams of the courier order (DS10), the hash a create must repeat,
 * the bodies of generateProtocol and packagesPickupCall in the shapes of the
 * sandbox fixtures (05a, 11j, 12a, 12u), and the handover marker (DS6).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { DEMO_PAYER_FID, DIMS_UNKNOWN_CM, DISPATCH_MAX_SHIPMENTS, PROTOCOL_OUTPUT } from "../src/modules/dpd/lib/constants.ts"
import {
  buildDispatchPlan,
  candidateProblems,
  clearedMarkerData,
  DISPATCH_ORDER_PROBLEM_CODES,
  DISPATCH_PROBLEM_CODES,
  dispatchPlanHash,
  dispatchReferenceOf,
  dispatchSenderOf,
  hasMarker,
  markerData,
  orderProblemsOf,
  packagesParamsFrom,
  packagesParamsOf,
  payerFidOf,
  pickupAddressOf,
  pickupCallRequest,
  pickupCallUpdateRequest,
  protocolRequest,
  senderGroupOf,
  shipmentBoxesOf,
  type DispatchSender,
  type DispatchShipmentInput,
} from "../src/modules/dpd/lib/dispatch.ts"
import type { ShipmentRow } from "../src/modules/dpd/lib/dto.ts"
import { resolveOptions, type DpdPluginOptions } from "../src/modules/dpd/lib/options.ts"
import { loadFixture } from "./fake-dpdservices.ts"

const SENDER = {
  company: "Testowa Firma Sp. z o.o.",
  name: "Jan Testowy",
  phone: "500000000",
  email: "test@example.com",
  street: "Testowa 1",
  city: "Warszawa",
  postalCode: "02-274",
}
const OTHER = { ...SENDER, company: "Magazyn Drugi", street: "Inna 2", city: "Kraków", postalCode: "30-001" }

const BASE: DpdPluginOptions = { login: "koda-test", password: "test-password-koda-0000", masterFid: "1000", payerFid: "1000", sender: SENDER, mode: "sandbox" }
const opts = (extra: DpdPluginOptions = {}) => resolveOptions({ ...BASE, ...extra })

function row(id: string, extra: Partial<ShipmentRow> = {}): ShipmentRow {
  return {
    id,
    order_id: `order_${id}`,
    display_id: 1000,
    fulfillment_id: `ful_${id}`,
    return_id: null,
    kind: "outbound",
    mode: "sandbox",
    option_id: "dpd-courier",
    service: null,
    pudo_id: null,
    country_code: "PL",
    session_type: "DOMESTIC",
    cod_minor: null,
    currency: null,
    reference: `ful_${id}`,
    references: null,
    boxes: { edited: false, items: [{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10, reference: `ful_${id}-1`, waybill: `W${id}` }] },
    waybills: [`W${id}`],
    session_id: null,
    state: "labeled",
    status: null,
    stage: null,
    plan_hash: null,
    problems: null,
    dispatch_id: null,
    handed_over_at: null,
    claim_token: null,
    lease_until: null,
    shipped_marked_at: null,
    delivered_marked_at: null,
    last_checked_at: null,
    error: null,
    error_code: null,
    attempts: 0,
    ...extra,
  }
}

function input(id: string, extra: Partial<ShipmentRow> = {}, location: string | null = "sloc_1", canceled: Date | null = null): DispatchShipmentInput {
  return { row: row(id, extra), fulfillment: { id: `ful_${id}`, location_id: location, canceled_at: canceled } }
}

const ctx = (shipmentIds: string[], extra: DpdPluginOptions = {}, demo = false) => ({ options: opts(extra), mode: "sandbox" as const, demo, shipmentIds })

test("candidates: labeled, outbound, domestic, not in a dispatch, not excluded", () => {
  const codes = (i: DispatchShipmentInput, demo = false) => candidateProblems(i, "sandbox", demo).map((p) => p.code)
  assert.deepEqual(codes(input("a")), [])
  assert.deepEqual(codes(input("a", { mode: "live" })), ["shipment_not_found"])
  assert.deepEqual(codes(input("a", { kind: "return" })), ["shipment_not_outbound"])
  assert.deepEqual(codes(input("a", { state: "excluded" })), ["shipment_excluded"])
  assert.deepEqual(codes(input("a", { state: "canceled" })), ["shipment_canceled"])
  assert.deepEqual(codes(input("a", { state: "skipped" })), ["shipment_canceled"])
  assert.deepEqual(candidateProblems(input("a", { state: "created" }), "sandbox", false), [{ code: "shipment_not_labeled", field: "shipments.a", detail: "created" }])
  assert.deepEqual(codes(input("a", { session_type: "INTERNATIONAL" })), ["shipment_not_domestic"])
  assert.deepEqual(codes(input("a", { session_type: null })), [], "a row without a session type is domestic")
  assert.deepEqual(candidateProblems(input("a", { dispatch_id: "dpddsp_1" }), "sandbox", false), [{ code: "shipment_dispatched", field: "shipments.a", detail: "dpddsp_1" }])
  assert.deepEqual(candidateProblems(input("a", { handed_over_at: new Date() }), "sandbox", false)[0]?.detail, "handed_over")
  /* DS13, E54: DPD has the parcel (dropped at a point, a courier outside the plugin), so no protocol and no courier for it. */
  assert.deepEqual(candidateProblems(input("a", { stage: "in_transit" }), "sandbox", false), [{ code: "shipment_picked_up", field: "shipments.a" }])
  for (const stage of ["in_point", "delivered", "returned"] as const) assert.deepEqual(codes(input("a", { stage })), ["shipment_picked_up"], stage)
  assert.deepEqual(codes(input("a", { shipped_marked_at: new Date() })), ["shipment_picked_up"], "the plugin marked it shipped")
  const held = [{ waybill: "Wa", box: 0, role: "outbound", stage: "problem", code: "160102", at: null, possession: true, lastCode: "160102", lastAt: null, description: null, supersededBy: null, supersededAt: null, from: null, checkedAt: null, done: false }]
  assert.deepEqual(codes(input("a", { stage: "problem", tracking: held })), ["shipment_picked_up"], "a problem with possession")
  const failedPickup = [{ ...held[0], code: "040201", lastCode: "040201", possession: false }]
  assert.deepEqual(codes(input("a", { stage: "problem", tracking: failedPickup })), [], "a failed pickup at the sender stays a candidate (E25)")
  assert.deepEqual(codes(input("a", { stage: "ready" })), [], "ready without possession is a candidate")
  assert.deepEqual(codes({ row: row("a"), fulfillment: null }), ["shipment_canceled"], "no fulfillment outside demo")
  assert.deepEqual(codes({ row: row("a"), fulfillment: null }, true), [], "tolerated in demo (DS6)")
  assert.deepEqual(codes(input("a", {}, "sloc_1", new Date())), ["shipment_canceled"])
  assert.deepEqual(codes(input("a", { reference: null, fulfillment_id: null })), ["shipment_no_reference"])
  assert.deepEqual(codes(input("a", { reference: null, fulfillment_id: null }), true), [], "demo falls back to the row id")
  assert.deepEqual(codes(input("a", { boxes: null })), ["shipment_boxes_missing"])
  assert.deepEqual(codes(input("a", { boxes: null }), true), [], "demo: one box per waybill")
  assert.deepEqual(codes(input("a", { boxes: null, waybills: [] }), true), ["shipment_boxes_missing"])
  assert.equal(dispatchReferenceOf({ id: "dpdshp_1", reference: null, fulfillment_id: "ful_1" }, false), "ful_1")
  for (const p of candidateProblems(input("a", { kind: "return", state: "created", boxes: null }), "sandbox", false)) {
    assert.ok((DISPATCH_PROBLEM_CODES as readonly string[]).includes(p.code), p.code)
    assert.equal(p.field, "shipments.a")
  }
})

test("no shipments and more than 100 give their problems", () => {
  const none = buildDispatchPlan([], ctx([]))
  assert.equal(none.ok, false)
  assert.deepEqual(none.problems, [{ code: "no_shipments" }])
  assert.equal(none.hash, "")
  const ids = Array.from({ length: DISPATCH_MAX_SHIPMENTS + 1 }, (_, i) => `s${String(i).padStart(3, "0")}`)
  const many = buildDispatchPlan(ids.map((id) => input(id)), ctx(ids))
  assert.equal(many.ok, false)
  assert.deepEqual(many.problems, [{ code: "too_many_shipments", detail: "101" }])
  assert.equal(many.shipments.length, 101, "the panel still lists them")
  const missing = buildDispatchPlan([input("a")], ctx(["a", "b"]))
  assert.deepEqual(missing.problems, [{ code: "shipment_not_found", field: "shipments.b" }])
  const ok = buildDispatchPlan([input("a"), input("b")], ctx(["a", "b"]))
  assert.equal(ok.ok, true)
  assert.equal(ok.canOrder, true)
  assert.equal(ok.hash.length, 24)
  assert.deepEqual(ok.shipments.map((s) => [s.id, s.reference, s.waybills, s.weightKg]), [["a", "ful_a", ["Wa"], 1], ["b", "ful_b", ["Wb"], 1]])
})

test("groups by location and sender; two senders give mixed_senders", () => {
  const withOwn = { senders: { sloc_2: OTHER } }
  assert.equal(senderGroupOf(opts(withOwn), "sloc_2"), "loc:sloc_2")
  assert.equal(senderGroupOf(opts(withOwn), "sloc_1"), "default")
  assert.equal(senderGroupOf(opts(withOwn), null), "default")
  /* Two locations without their own sender are one group: the shop's sender. */
  const same = buildDispatchPlan([input("a", {}, "sloc_1"), input("b", {}, "sloc_3")], ctx(["a", "b"], withOwn))
  assert.equal(same.ok, true)
  assert.deepEqual(same.groups.map((g) => [g.key, g.locationId, g.shipmentIds]), [["default", null, ["a", "b"]]])
  assert.equal(same.sender?.address.city, "Warszawa")
  assert.equal(same.sender?.address.postalCode, "02274")
  const mixed = buildDispatchPlan([input("a", {}, "sloc_1"), input("b", {}, "sloc_2"), input("c", {}, "sloc_1")], ctx(["a", "b", "c"], withOwn))
  assert.equal(mixed.ok, false)
  assert.deepEqual(mixed.problems, [{ code: "mixed_senders", detail: "2" }])
  assert.deepEqual(mixed.groups.map((g) => [g.key, g.shipmentIds, g.sender?.city]), [["default", ["a", "c"], "Warszawa"], ["loc:sloc_2", ["b"], "Kraków"]])
  assert.equal(mixed.sender, null)
  assert.equal(mixed.params, null)
  assert.equal(mixed.hash, "")
  /* The one group of a location with its own sender: its sender, the shop's orderer. */
  const own = buildDispatchPlan([input("b", {}, "sloc_2")], ctx(["b"], { ...withOwn, orderer: { name: "Zamawiający", fullName: "Jan Testowy", phone: "500000001" } }))
  assert.equal(own.ok, true)
  assert.equal(own.locationId, "sloc_2")
  assert.equal(own.sender?.resolved.city, "Kraków")
  assert.equal(own.sender?.orderer.name, "Zamawiający")
  /* Location senders only, no shop sender: the orderer option still wins; its empty fields fall back to the location sender. */
  const onlyLocations = resolveOptions({ login: "x", password: "y", masterFid: "1000", senders: { sloc_2: OTHER }, orderer: { name: "Dyspozytor", fullName: "Anna Nowak", phone: "600100200" } })
  const located = buildDispatchPlan([input("b", {}, "sloc_2")], { options: onlyLocations, mode: "sandbox", demo: false, shipmentIds: ["b"] })
  assert.equal(located.ok, true, JSON.stringify(located.problems))
  assert.deepEqual(located.sender?.orderer, { name: "Dyspozytor", fullName: "Anna Nowak", phone: "600100200" })
  const partial = resolveOptions({ login: "x", password: "y", masterFid: "1000", senders: { sloc_2: OTHER }, orderer: { fullName: "Anna Nowak" } })
  const mixedOrderer = buildDispatchPlan([input("b", {}, "sloc_2")], { options: partial, mode: "sandbox", demo: false, shipmentIds: ["b"] })
  assert.deepEqual(mixedOrderer.sender?.orderer, { name: OTHER.company, fullName: "Anna Nowak", phone: mixedOrderer.sender?.resolved.phone })
  /* No sender: sender_missing outside demo, DEMO_SENDER and sample_sender in demo; no payer: payer_fid_missing. */
  const bare = buildDispatchPlan([input("a")], { options: resolveOptions({ login: "x", password: "y", masterFid: "1000" }), mode: "sandbox", demo: false, shipmentIds: ["a"] })
  assert.deepEqual(bare.problems.map((p) => p.code), ["sender_missing"], "payerFid falls back to masterFid")
  const noPayer = buildDispatchPlan([input("a")], { options: { ...opts(), payerFid: null }, mode: "sandbox", demo: false, shipmentIds: ["a"] })
  assert.deepEqual(noPayer.problems, [{ code: "payer_fid_missing", field: "payerFid" }])
  const demo = buildDispatchPlan([{ row: row("a", { mode: "demo" }), fulfillment: null }], { options: resolveOptions({ demo: true }), mode: "demo", demo: true, shipmentIds: ["a"] })
  assert.equal(demo.ok, true)
  assert.deepEqual(demo.warnings.map((w) => w.code), ["sample_sender"])
  assert.equal(demo.sender?.resolved.company, "Sample Store")
  assert.equal(payerFidOf({ demo: true, payerFid: null }, true), DEMO_PAYER_FID)
  assert.equal(payerFidOf({ demo: false, payerFid: 1000 }, false), 1000)
  /* Step 2 only: an orderer without a phone blocks the order, not the protocol. */
  const noPhone = buildDispatchPlan([input("a")], ctx(["a"], { sender: { ...SENDER, phone: "" }, orderer: { name: "A", fullName: "B" } }))
  assert.ok(noPhone.orderProblems.some((p) => p.code === "orderer_invalid"))
  assert.ok(noPhone.orderProblems.every((p) => DISPATCH_ORDER_PROBLEM_CODES.includes(p.code)))
})

test("packagesParams: count, weight sum, heaviest box, 1 cm when no side (dims_unknown)", () => {
  const box = (weightKg: number, l: number | null = null, w: number | null = null, h: number | null = null) => ({ weightKg, lengthCm: l, widthCm: w, heightCm: h })
  /* The example of spec 7.7. */
  const example = packagesParamsOf([box(1, 10, 10, 10), box(2), box(2)], { weightKg: 1, lengthCm: 30, widthCm: 20, heightCm: 10 })
  assert.deepEqual(example.params, { doxCount: 0, parcel: { count: 3, weight: 5, maxWeight: 2, maxHeight: 10, maxWidth: 20, maxDepth: 30 } })
  assert.deepEqual(example.warnings, [])
  const unknown = packagesParamsOf([box(1.1), box(2.2, 40)], null)
  assert.deepEqual(unknown.params.parcel, { count: 2, weight: 3.3, maxWeight: 2.2, maxHeight: DIMS_UNKNOWN_CM, maxWidth: DIMS_UNKNOWN_CM, maxDepth: 40 })
  assert.deepEqual(unknown.warnings, [{ code: "dims_unknown", detail: "maxHeight, maxWidth" }])
  const heavy = packagesParamsOf([box(10, 10, 10, 10), box(51, 10, 10, 10)], null)
  assert.deepEqual(heavy.orderProblems, [{ code: "courier_over_50kg", field: "parcel.maxWeight", detail: "box 2, 51 kg" }])
  const plan = buildDispatchPlan([input("a", { boxes: { edited: true, items: [{ weightKg: 51, lengthCm: 10, widthCm: 10, heightCm: 10 }] } })], ctx(["a"]))
  assert.equal(plan.ok, true, "over 50 kg blocks step 2 only (H14)")
  assert.equal(plan.canOrder, false)
  assert.deepEqual(orderProblemsOf(plan.sender as DispatchSender, plan.params ?? heavy.params).map((p) => p.code), ["courier_over_50kg"])
  /* Demo rows without boxes: one box per waybill, the defaultBox weight. */
  assert.deepEqual(shipmentBoxesOf({ boxes: null, waybills: ["A", "B"] }, { weightKg: 2, lengthCm: 30, widthCm: null, heightCm: null }, true), [
    { weightKg: 2, lengthCm: 30, widthCm: null, heightCm: null },
    { weightKg: 2, lengthCm: 30, widthCm: null, heightCm: null },
  ])
  assert.equal(shipmentBoxesOf({ boxes: null, waybills: ["A"] }, null, false), null)
  assert.deepEqual(packagesParamsFrom(JSON.stringify(example.params)), example.params)
  assert.equal(packagesParamsFrom({ doxCount: 1, parcel: example.params.parcel }), null)
  assert.equal(packagesParamsFrom({ doxCount: 0, parcel: { ...example.params.parcel, weight: "5" } }), null)
})

test("plan hash ignores the order of the ids and changes with a waybill", () => {
  const ab = buildDispatchPlan([input("a"), input("b")], ctx(["a", "b"]))
  const ba = buildDispatchPlan([input("b"), input("a")], ctx(["b", "a"]))
  assert.equal(ab.hash, ba.hash)
  assert.deepEqual(ba.shipments.map((s) => s.id), ["b", "a"], "the protocol order is the order picked")
  const other = buildDispatchPlan([input("a"), input("b", { waybills: ["Wb2"] })], ctx(["a", "b"]))
  assert.notEqual(other.hash, ab.hash)
  const heavier = buildDispatchPlan([input("a"), input("b", { boxes: { edited: true, items: [{ weightKg: 2, lengthCm: 10, widthCm: 10, heightCm: 10 }] } })], ctx(["a", "b"]))
  assert.notEqual(heavier.hash, ab.hash)
  const moved = buildDispatchPlan([input("a"), input("b")], ctx(["a", "b"], { sender: { ...SENDER, street: "Testowa 2" } }))
  assert.notEqual(moved.hash, ab.hash)
  assert.equal(dispatchPlanHash({ shipments: [{ id: "a", waybills: ["Wa"] }], sender: null, params: null }).length, 24)
  /* A snapshot read back hashes the same. */
  const back = dispatchSenderOf(JSON.parse(JSON.stringify(ab.sender)))
  assert.deepEqual(back, ab.sender)
  assert.equal(dispatchSenderOf({ address: { city: "x" } }), null)
  assert.equal(dispatchSenderOf("not json"), null)
})

function testSender(): DispatchSender {
  const plan = buildDispatchPlan([input("a")], ctx(["a"], { orderer: { name: "Testowa Firma", fullName: "Jan Testowy", phone: "500000000" } }))
  assert.ok(plan.sender)
  if (!plan.sender) throw new Error("no sender")
  return plan.sender
}

test("protocol request equals the expected body for 05a", () => {
  const sender = testSender()
  const pickupAddress = pickupAddressOf(sender, 1000)
  const sent = loadFixture("05a-protocol-by-package-ref").request.body
  const got = protocolRequest(["probe-mvzj6089-R1"], pickupAddress)
  /* 05a was sent without pickupAddress; the plugin always sends it (H5, 11j). */
  assert.ok(sent !== null && typeof sent === "object" && "protocolSearchParams" in sent)
  const want = JSON.parse(JSON.stringify(sent))
  want.protocolSearchParams.pickupAddress = pickupAddress
  assert.deepEqual(got, want)
  assert.equal(got.outputDocFormat, PROTOCOL_OUTPUT.outputDocFormat)
  assert.equal(got.protocolSearchParams.policy, PROTOCOL_OUTPUT.policy)
  /* The keys of pickupAddress in the order of 11j, the FID of the payer. */
  const j = JSON.parse(JSON.stringify(loadFixture("11j-protocol-three-pickupaddress").request.body))
  assert.deepEqual(Object.keys(pickupAddress), Object.keys(j.protocolSearchParams.pickupAddress))
  assert.deepEqual({ ...pickupAddress, fid: "***" }, j.protocolSearchParams.pickupAddress)
  const bare = pickupAddressOf({ ...sender, address: { address: "Testowa 1", city: "Warszawa", countryCode: "PL", postalCode: "02274" } }, 1)
  assert.deepEqual(Object.keys(bare), ["fid", "address", "city", "countryCode", "postalCode"], "empty fields are left out")
})

test("pickup call body equals the shape of 12a", () => {
  const sender = testSender()
  const params = packagesParamsOf([{ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 }], null).params
  const window = { pickupDate: "2026-11-06", pickupTimeFrom: "09:00", pickupTimeTo: "17:00" }
  const body = pickupCallRequest({ window, sender, params, payerFid: 1000 })
  const want = JSON.parse(JSON.stringify(loadFixture("12a-order").request.body).replace(/"number":"\*\*\*"/, '"number":1000'))
  assert.equal(JSON.stringify(body), JSON.stringify(want), "the same keys in the same order")
  /* PATCH (12u): no orderType, no orderer, payer by name only, sender without postalCode. */
  const update = pickupCallUpdateRequest({ orderNumber: "***", checkSum: "********", window: { ...window, pickupDate: "2026-11-05" }, sender, params })
  assert.equal(JSON.stringify(update), JSON.stringify(loadFixture("12u-patch-unknown-order").request.body))
  const noCompany = { ...sender, resolved: { ...sender.resolved, company: "" } }
  assert.deepEqual(pickupCallUpdateRequest({ orderNumber: "1", checkSum: "12345678", window, sender: noCompany, params }).packagesForCollection.payer, {})
  assert.deepEqual(pickupCallRequest({ window, sender: noCompany, params, payerFid: 1000 }).packagesForCollection.sender.name, "Jan Testowy", "no company: the person")
})

test("markerData, clearedMarkerData and hasMarker", () => {
  const at = new Date("2026-11-03T09:00:00Z")
  assert.deepEqual(markerData("dpddsp_1", at), { dpd_handed_over_at: "2026-11-03T09:00:00.000Z", dpd_dispatch_id: "dpddsp_1" })
  assert.deepEqual(clearedMarkerData(), { dpd_handed_over_at: null, dpd_dispatch_id: null })
  assert.equal(hasMarker(markerData("dpddsp_1", at)), true)
  assert.equal(hasMarker({ ...markerData("dpddsp_1", at), ...clearedMarkerData() }), false)
  for (const v of [{ dpd_handed_over_at: "" }, { dpd_handed_over_at: null }, { dpd_handed_over_at: 1 }, null, undefined, "x", []]) assert.equal(hasMarker(v), false, JSON.stringify(v))
})
