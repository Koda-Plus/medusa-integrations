/**
 * The tracking of a shipment (6.2, 6.5): the fold of one waybill, the stage
 * of the row, repins (DS3, E2, E15, E26), the event that set a stage (E11),
 * the end of polling and the pickup test of DS13. Pure functions, no store.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import type { ShipmentRow } from "../src/modules/dpd/lib/dto.ts"
import type { InfoEvent } from "../src/modules/dpd/lib/infoservices.ts"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { SIM_IN_POINT } from "../src/modules/dpd/lib/constants.ts"
import { BUILTIN_CODE_RULES, buildCodeMap } from "../src/modules/dpd/lib/status-codes.ts"
import {
  foldRow,
  foldWaybill,
  isPickedUp,
  readTracking,
  repinCandidate,
  rowStage,
  rowStatus,
  trackingDone,
  trackingOf,
  waybillsToAsk,
  type MappedEvent,
  type TrackingEntry,
} from "../src/modules/dpd/lib/tracking.ts"
import { loadInfoFixture } from "./fake-infoservices.ts"
import { parseEventsResponse } from "../src/modules/dpd/lib/infoservices.ts"

const map = buildCodeMap({})
const NOW = new Date("2026-11-03T12:00:00.000Z")
const A = "0000000000101S"
const B = "0000000000201S"
const C = "0000000000301S"
const R = "0000000000302R"

let seq = 0
/** An event as the pass gives it to the fold: mapped, with an event id (null: a repeat). */
function ev(waybill: string, code: string, at: string, over: Partial<MappedEvent> = {}): MappedEvent {
  const base: InfoEvent = {
    waybill,
    code,
    description: `d${code}`,
    eventTimeRaw: at,
    eventTime: at,
    depot: "1305",
    depotName: null,
    country: "PL",
    objectId: null,
    data: [],
    queueId: null,
    operationType: null,
  }
  return { ...base, known: map.lookup(code), eventId: `dpdevt_${++seq}`, ...over }
}

const repinData = (to: string) => ["01", "02", "03"].map((code) => ({ code, description: null, value: `<![CDATA[${to}]]>` }))

/* A fresh entry of readTracking with fields set (a superseded one too, which readTracking alone would drop). */
function entry(waybill: string, over: Partial<TrackingEntry> = {}): TrackingEntry {
  return { ...readTracking([], [waybill])[0], ...over }
}

function row(over: Partial<ShipmentRow> = {}): ShipmentRow {
  return {
    id: "dpdshp_1",
    order_id: "order_1",
    display_id: 1,
    fulfillment_id: "ful_1",
    return_id: null,
    kind: "outbound",
    mode: "sandbox",
    option_id: "dpd-courier",
    service: null,
    pudo_id: null,
    country_code: "PL",
    session_type: "DOMESTIC",
    cod_minor: null,
    currency: "PLN",
    reference: null,
    references: null,
    boxes: null,
    waybills: [A],
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
    created_at: "2026-11-01T10:00:00.000Z",
    tracking: null,
    status_at: null,
    ...over,
  }
}

const box = (waybill: string | null) => ({ weightKg: 1, lengthCm: null, widthCm: null, heightCm: null, reference: null, waybill })

test("foldWaybill rules 1 to 7 of 6.2", () => {
  /* 1. Sorted by eventTime, whatever the answer order (H6); 7. lastCode from the newest move. */
  const f = foldWaybill(entry(A), [ev(A, "170101", "2026-11-02T08:00:00.000Z"), ev(A, "040101", "2026-11-01T12:00:00.000Z"), ev(A, "050101", "2026-11-01T18:00:00.000Z")], NOW)
  const e = f.entries[0]
  assert.deepEqual([e.stage, e.code, e.at, e.lastCode, e.lastAt, e.description], ["in_transit", "170101", "2026-11-02T08:00:00.000Z", "170101", "2026-11-02T08:00:00.000Z", "d170101"])
  assert.equal(e.checkedAt, NOW.toISOString())
  assert.equal(e.done, false)
  /* 2. A notification never moves the stage nor lastCode. */
  const n = foldWaybill(e, [ev(A, "170301", "2026-11-02T09:00:00.000Z")], NOW).entries[0]
  assert.deepEqual([n.stage, n.code, n.lastCode, n.possession], ["in_transit", "170101", "170101", true])
  /* 3. Possession stays once seen; 030103 alone gives none. */
  const p = foldWaybill(entry(A), [ev(A, "030103", "2026-11-01T10:00:00.000Z")], NOW).entries[0]
  assert.deepEqual([p.stage, p.possession], ["preparing", false])
  assert.equal(foldWaybill({ ...p, possession: true }, [ev(A, "040201", "2026-11-01T11:00:00.000Z")], NOW).entries[0].possession, true)
  /* 4. An unknown code: in_transit only when no known code set the stage; it never overwrites a known one. */
  const u = foldWaybill(entry(A), [ev(A, "999999", "2026-11-01T10:00:00.000Z")], NOW).entries[0]
  assert.deepEqual([u.stage, u.code, u.lastCode, u.possession], ["in_transit", "999999", "999999", false])
  const k = foldWaybill(entry(A), [ev(A, "030103", "2026-11-01T10:00:00.000Z"), ev(A, "999999", "2026-11-01T11:00:00.000Z")], NOW).entries[0]
  assert.deepEqual([k.stage, k.code, k.lastCode], ["preparing", "030103", "999999"])
  /* 5. Delivered stays: a later known event changes nothing but lastCode. */
  const d = foldWaybill(entry(A), [ev(A, "190101", "2026-11-02T10:00:00.000Z"), ev(A, "170101", "2026-11-02T11:00:00.000Z")], NOW).entries[0]
  assert.deepEqual([d.stage, d.code, d.lastCode, d.done], ["delivered", "190101", "170101", true])
  /* A partial answer with an older event never moves the stored stage back. */
  const older = foldWaybill(e, [ev(A, "040101", "2026-11-01T12:00:00.000Z")], NOW).entries[0]
  assert.deepEqual([older.stage, older.code, older.lastCode], ["in_transit", "170101", "170101"])
  /* An unreadable time stays out of the fold. */
  const t = foldWaybill(entry(A), [ev(A, "190101", "x", { eventTime: null })], NOW).entries[0]
  assert.equal(t.stage, null)
  /* 6. A repin code with one candidate. */
  const r = foldWaybill(entry(C), [ev(C, "170101", "2026-11-02T08:00:00.000Z"), ev(C, "230403", "2026-11-02T14:00:00.000Z", { data: repinData(R) })], NOW)
  assert.deepEqual(r.repin && { ...r.repin, eventId: null }, { from: C, to: R, box: 0, role: "return", code: "230403", at: "2026-11-02T14:00:00.000Z", eventId: null })
  assert.deepEqual([r.entries[0].supersededBy, r.entries[0].supersededAt, r.entries[0].stage], [R, "2026-11-02T14:00:00.000Z", "returned"])
  assert.deepEqual(
    [r.entries[1].waybill, r.entries[1].role, r.entries[1].stage, r.entries[1].code, r.entries[1].possession, r.entries[1].from, r.entries[1].done],
    [R, "return", "returned", null, true, C, false],
  )
  /* A redirect keeps the role and gives in_transit. */
  const rd = foldWaybill(entry(C), [ev(C, "230402", "2026-11-02T14:00:00.000Z", { data: [{ code: "01", description: null, value: R }] })], NOW)
  assert.deepEqual([rd.repin?.role, rd.entries[1].stage], ["outbound", "in_transit"])
  /* A repin code without a single candidate: the stage of the code only, and repinUnclear. */
  const un = foldWaybill(entry(C), [ev(C, "230403", "2026-11-02T14:00:00.000Z", { data: [] })], NOW)
  assert.deepEqual([un.repin, un.entries.length, un.entries[0].stage, un.repinUnclear.length], [null, 1, "returned", 1])
})

test("the stage is replayed from the whole answer: a late event older than the stored stage counts, fed pass by pass or at once", () => {
  /* A partner reports the return 500610 late, with its real scan time before the stored 050101. */
  const answers = [
    [ev(A, "500101", "2026-10-02T10:00:00.000Z")],
    [ev(A, "500101", "2026-10-02T10:00:00.000Z", { eventId: null }), ev(A, "050101", "2026-10-05T10:00:00.000Z")],
    [ev(A, "500101", "2026-10-02T10:00:00.000Z", { eventId: null }), ev(A, "050101", "2026-10-05T10:00:00.000Z", { eventId: null }), ev(A, "500610", "2026-10-04T10:00:00.000Z")],
    [
      ev(A, "500101", "2026-10-02T10:00:00.000Z", { eventId: null }),
      ev(A, "050101", "2026-10-05T10:00:00.000Z", { eventId: null }),
      ev(A, "500610", "2026-10-04T10:00:00.000Z", { eventId: null }),
      ev(A, "190101", "2026-10-06T10:00:00.000Z"),
    ],
  ]
  let stored = entry(A)
  const stages: Array<string | null> = []
  for (const answer of answers) {
    stored = foldWaybill(stored, answer, NOW).entries[0]
    stages.push(stored.stage)
  }
  assert.deepEqual(stages, ["in_transit", "in_transit", "returned", "returned"])
  const once = foldWaybill(entry(A), answers[3], NOW).entries[0]
  assert.deepEqual([stored.stage, stored.code, stored.at, stored.done], [once.stage, once.code, once.at, once.done])
  assert.deepEqual([once.stage, once.code, once.done], ["returned", "500610", false], "returned is sticky in time order (E7): never delivered after it")
  /* The pass that read the late event names it as the event of the stage. */
  const late = foldWaybill(foldWaybill(foldWaybill(entry(A), answers[0], NOW).entries[0], answers[1], NOW).entries[0], answers[2], NOW)
  assert.equal(late.stageEventId, answers[2][2].eventId)
  /* A late 190101 older than a stored depot scan ends the polling. */
  const depot = foldWaybill(entry(A), [ev(A, "040101", "2026-10-02T10:00:00.000Z"), ev(A, "050101", "2026-10-05T10:00:00.000Z")], NOW).entries[0]
  const delivered = foldWaybill(depot, [ev(A, "040101", "2026-10-02T10:00:00.000Z", { eventId: null }), ev(A, "050101", "2026-10-05T10:00:00.000Z", { eventId: null }), ev(A, "190101", "2026-10-04T10:00:00.000Z")], NOW).entries[0]
  assert.deepEqual([delivered.stage, delivered.code, delivered.done], ["delivered", "190101", true])
})

test("rowStage: returned, then problem, then delivered only when every waybill is", () => {
  const r = { stage: null, handed_over_at: null, waybills: [A, B] }
  const e = (waybill: string, over: Partial<TrackingEntry>) => entry(waybill, over)
  assert.equal(rowStage([e(A, { stage: "returned", code: "500610" }), e(B, { stage: "problem" })], r), "returned")
  assert.equal(rowStage([e(A, { role: "return", stage: "in_transit" }), e(B, { stage: "delivered" })], r), "returned")
  assert.equal(rowStage([e(A, { stage: "problem" }), e(B, { stage: "delivered" })], r), "problem")
  assert.equal(rowStage([e(A, { stage: "delivered" }), e(B, { stage: "delivered" })], r), "delivered")
  assert.equal(rowStage([e(A, { stage: "delivered" }), e(B, { stage: "in_point" })], r), "in_point")
  assert.equal(rowStage([e(A, { stage: "in_transit" }), e(B, { stage: "in_point" })], r), "in_transit")
  /* A superseded entry does not count. */
  assert.equal(rowStage([e(A, { stage: "problem", supersededBy: B }), e(B, { stage: "in_transit" })], r), "in_transit")
  /* Rule 5 and canceled. */
  assert.equal(rowStage([e(A, {}), e(B, {})], { ...r, stage: "ready" }), "ready")
  assert.equal(rowStage([e(A, {}), e(B, {})], r), null)
  assert.equal(rowStage([e(A, { stage: "delivered" })], { ...r, stage: "canceled" }), "canceled")
})

test("a row of two waybills, one delivered and one with no events, is preparing and ready after the handover, never delivered", () => {
  const entries = [entry(A, { stage: "delivered", code: "190101" }), readTracking([], [A, B])[1]]
  assert.equal(rowStage(entries, { stage: null, handed_over_at: null, waybills: [A, B] }), "preparing")
  assert.equal(rowStage(entries, { stage: "ready", handed_over_at: "2026-11-02T10:00:00Z", waybills: [A, B] }), "ready")
})

test("repinCandidate takes exactly one distinct value matching WAYBILL_PATTERN; the same value under 01, 02 and 03 is one", () => {
  const k = map.lookup("230403")
  const e = (data: Array<{ code: string; value: string }>) => ({ waybill: C, code: "230403", data: data.map((d) => ({ ...d, description: null })) })
  assert.deepEqual(repinCandidate(e([{ code: "01", value: R }, { code: "02", value: R }, { code: "03", value: R }]), k), { to: R })
  assert.deepEqual(repinCandidate(e([{ code: "01", value: `<![CDATA[ ${R} ]]>` }]), k), { to: R })
  assert.equal(repinCandidate(e([{ code: "01", value: R }, { code: "02", value: "0000000000303R" }]), k), "unclear")
  assert.equal(repinCandidate(e([{ code: "01", value: C }]), k), "unclear", "its own waybill is no candidate")
  assert.equal(repinCandidate(e([{ code: "01", value: "abc" }]), k), "unclear")
  assert.equal(repinCandidate(e([{ code: "01", value: R }]), map.lookup("170101")), null, "not a repin code")
  assert.equal(repinCandidate(e([{ code: "01", value: R }]), null), null)
  /* The repin fixture: three times the same new waybill. */
  const fx = parseEventsResponse(loadInfoFixture("pdf-repin-230403.response.xml").body)
  assert.ok(fx)
  assert.deepEqual(repinCandidate(fx.events[1], map.lookup(fx.events[1].code)), { to: R })
})

test("parcel_3 of the PDF is unclear, never a repin", () => {
  const fx = parseEventsResponse(loadInfoFixture("pdf-cdata-eventdata.response.xml").body)
  assert.ok(fx)
  assert.equal(repinCandidate(fx.events[0], map.lookup("230403")), "unclear")
  const v4 = parseEventsResponse(loadInfoFixture("pdf-customer-v4.response.xml").body)
  assert.ok(v4)
  assert.equal(repinCandidate(v4.events[1], map.lookup("170301")), null, "170301 with parcel_1 is no repin code (H8)")
})

test("a second fold of a superseded waybill with the same repin event gives no repin and keeps the entry of the new waybill", () => {
  const events = [ev(C, "170101", "2026-11-02T08:00:00.000Z"), ev(C, "230403", "2026-11-02T14:00:00.000Z", { data: repinData(R) })]
  const first = foldRow(row({ waybills: [C] }), new Map([[C, events]]), NOW)
  assert.deepEqual(first.waybills, [R])
  assert.equal(first.repins.length, 1)
  assert.deepEqual(first.tracking.map((e) => [e.waybill, e.supersededBy, e.done]), [[R, null, false], [C, R, false]])
  assert.equal(first.stage, "returned")
  /* The next pass asks the old waybill once more (ALL brings the same repin event again) and the new one. */
  const stored = row({ waybills: first.waybills, tracking: first.tracking, stage: first.stage })
  assert.deepEqual(waybillsToAsk(trackingOf(stored)).map((e) => e.waybill), [R, C])
  const repeat = events.map((e) => ({ ...e, eventId: null }))
  const second = foldRow(stored, new Map([[C, repeat], [R, [ev(R, "050101", "2026-11-03T08:00:00.000Z")]]]), NOW)
  assert.deepEqual(second.repins, [])
  /* E57: the repeat is reported, so the history and dpd_waybills can be written again if they were lost. */
  assert.deepEqual(first.repeats, [])
  assert.deepEqual(second.repeats.map((r) => [r.from, r.to, r.code, r.box, r.role]), [[C, R, "230403", 0, "return"]])
  assert.deepEqual(second.waybills, [R])
  assert.deepEqual(second.tracking.map((e) => [e.waybill, e.supersededBy, e.done]), [[R, null, false], [C, R, true]])
  assert.equal(second.tracking[0].from, C)
  assert.deepEqual(waybillsToAsk(second.tracking).map((e) => e.waybill), [R])
})

test("the in_transit a redirect gives its new waybill is a floor: the new waybill's own 030103 never takes the row back to ready (E60)", () => {
  const D = "0000000000303S"
  const handedAt = new Date("2026-11-02T07:00:00.000Z")
  const events = [
    ev(C, "030103", "2026-11-02T06:00:00.000Z"),
    ev(C, "040101", "2026-11-02T08:00:00.000Z"),
    ev(C, "230402", "2026-11-02T14:00:00.000Z", { data: [{ code: "01", description: null, value: D }] }),
  ]
  const first = foldRow(row({ waybills: [C], stage: "ready", handed_over_at: handedAt }), new Map([[C, events]]), NOW)
  assert.equal(first.stage, "in_transit")
  assert.deepEqual(first.waybills, [D])
  /* DPD answers the new number with its own history: data registered at the redirect, then nothing yet. */
  const stored = row({ waybills: first.waybills, tracking: first.tracking, stage: first.stage, handed_over_at: handedAt })
  const second = foldRow(stored, new Map([[D, [ev(D, "030103", "2026-11-02T14:05:00.000Z")]]]), NOW)
  assert.equal(second.stage, "in_transit", "never back to ready")
  assert.equal(second.stageEventId, null, "no stage change, so no event of a stage")
  const live = second.tracking.find((e) => e.waybill === D)
  assert.deepEqual([live?.stage, live?.code, live?.possession, live?.lastCode], ["in_transit", null, true, "030103"], "the status still shows the newest event")
  /* A code at or above the floor moves it as before, and the stored code ends the floor. */
  const third = foldRow(
    row({ waybills: second.waybills, tracking: second.tracking, stage: second.stage, handed_over_at: handedAt }),
    new Map([[D, [ev(D, "030103", "2026-11-02T14:05:00.000Z", { eventId: null }), ev(D, "190101", "2026-11-03T09:00:00.000Z")]]]),
    NOW,
  )
  assert.equal(third.stage, "delivered")
  /* A problem code is not ranked, so the floor never hides it. */
  const problem = foldRow(stored, new Map([[D, [ev(D, "030103", "2026-11-02T14:05:00.000Z"), ev(D, "040201", "2026-11-02T15:00:00.000Z")]]]), NOW)
  assert.equal(problem.stage, "problem")
  /* The floor is only the stage a repin gave: a fresh entry without a code still gives way (6.2 step 4). */
  assert.equal(foldWaybill(entry(A, { stage: "in_transit" }), [ev(A, "030103", "2026-11-02T06:00:00.000Z")], NOW).entries[0].stage, "preparing")
})

test("waybillsToAsk: never asked first, then the oldest checkedAt, box order on a tie, done ones left out", () => {
  const D = "0000000000401S"
  const entries = [
    entry(A, { box: 0, checkedAt: "2026-11-03T10:00:00.000Z" }),
    entry(B, { box: 1, checkedAt: "2026-11-03T09:00:00.000Z" }),
    entry(C, { box: 2, checkedAt: null }),
    entry(D, { box: 3, checkedAt: "2026-11-03T09:00:00.000Z" }),
    entry(R, { box: 4, checkedAt: null, done: true }),
  ]
  assert.deepEqual(waybillsToAsk(entries).map((e) => e.waybill), [C, B, D, A])
  /* Never asked at all: the box order of readTracking. */
  assert.deepEqual(waybillsToAsk(readTracking([], [A, B, C])).map((e) => e.waybill), [A, B, C])
})

test("stageEventId of a two waybill row is the newest event inserted now among the entries at the new stage", () => {
  const a = ev(A, "170101", "2026-11-02T08:00:00.000Z", { eventId: "dpdevt_a" })
  const b = ev(B, "170101", "2026-11-02T09:00:00.000Z", { eventId: "dpdevt_b" })
  const f = foldRow(row({ waybills: [A, B] }), new Map([[A, [a]], [B, [b]]]), NOW)
  assert.equal(f.stage, "in_transit")
  assert.equal(f.stageEventId, "dpdevt_b")
  /* A repeat (eventId null) is never chosen; the other entry at the stage is. */
  const g = foldRow(row({ waybills: [A, B] }), new Map([[A, [a]], [B, [{ ...b, eventId: null }]]]), NOW)
  assert.equal(g.stageEventId, "dpdevt_a")
  /* An entry at another stage is not chosen: the row is in_transit by A, so B delivered is skipped. */
  const h = foldRow(row({ waybills: [A, B] }), new Map([[A, [a]], [B, [ev(B, "190101", "2026-11-02T10:00:00.000Z", { eventId: "dpdevt_d" })]]]), NOW)
  assert.deepEqual([h.stage, h.stageEventId], ["in_transit", "dpdevt_a"])
  /* Same time: the lower box. */
  const same = foldRow(row({ waybills: [A, B] }), new Map([[A, [a]], [B, [{ ...b, eventTime: a.eventTime }]]]), NOW)
  assert.equal(same.stageEventId, "dpdevt_a")
})

test("readTracking drops entries of waybills no longer stored and adds the stored ones", () => {
  const W1 = "0000000000001Q"
  const W2 = "0000000000002Q"
  const stored = [{ waybill: W1, box: 0, stage: "in_transit", possession: true }]
  const t = readTracking(stored, [W2])
  assert.deepEqual(t.map((e) => [e.waybill, e.box, e.stage, e.possession]), [[W2, 0, null, false]])
  /* A repinned old waybill stays while its chain ends in a stored waybill. */
  const chain = readTracking([{ waybill: R, box: 0, role: "return" }, { waybill: C, box: 0, supersededBy: R }], [R])
  assert.deepEqual(chain.map((e) => e.waybill), [R, C])
  assert.deepEqual(readTracking([{ waybill: C, box: 0, supersededBy: R }], [A]).map((e) => e.waybill), [A])
  /* Garbage is read leniently. */
  assert.deepEqual(readTracking("nope", [A]).map((e) => e.waybill), [A])
  assert.deepEqual(readTracking([null, 1, { waybill: "" }, { waybill: A, box: -3, stage: "flying" }], [A]).map((e) => [e.box, e.stage]), [[0, null]])
})

test("trackingOf builds entries from waybills for a row before stage 5", () => {
  const t = trackingOf(row({ waybills: [A, B], tracking: undefined }))
  assert.deepEqual(t.map((e) => [e.waybill, e.box, e.role, e.stage, e.possession, e.done]), [[A, 0, "outbound", null, false, false], [B, 1, "outbound", null, false, false]])
  assert.deepEqual(trackingOf(row({ waybills: null })), [])
})

test("trackingDone of 6.5", () => {
  const day = 86_400_000
  assert.equal(trackingDone(row(), NOW), false)
  assert.equal(trackingDone(row({ kind: "return" }), NOW), true)
  assert.equal(trackingDone(row({ state: "excluded" }), NOW), true)
  assert.equal(trackingDone(row({ stage: "delivered" }), NOW), true)
  assert.equal(trackingDone(row({ stage: "canceled" }), NOW), true)
  assert.equal(trackingDone(row({ created_at: new Date(NOW.getTime() - 31 * day) }), NOW), true)
  assert.equal(trackingDone(row({ created_at: new Date(NOW.getTime() - 31 * day), handed_over_at: new Date(NOW.getTime() - 29 * day) }), NOW), false, "the window runs from the handover")
  /* returned with a live return entry delivered: the parcel is back. */
  const back = [{ waybill: R, box: 0, role: "return", stage: "delivered" }, { waybill: C, box: 0, supersededBy: R, done: true }]
  assert.equal(trackingDone(row({ waybills: [R], stage: "returned", tracking: back }), NOW), true)
  /* A sticky returned without a return entry is asked until the end of the window (E7). */
  assert.equal(trackingDone(row({ waybills: [A], stage: "returned", tracking: [{ waybill: A, stage: "returned", code: "500610" }] }), NOW), false)
})

test("isPickedUp from shipped_marked_at, possession or a stage of STAGES_AFTER_READY; problem only with possession", () => {
  assert.equal(isPickedUp(row()), false)
  assert.equal(isPickedUp(row({ shipped_marked_at: NOW })), true)
  assert.equal(isPickedUp(row({ stage: "in_transit" })), true)
  assert.equal(isPickedUp(row({ stage: "ready" })), false)
  const fold = (events: MappedEvent[]) => {
    const f = foldRow(row(), new Map([[A, events]]), NOW)
    return row({ tracking: f.tracking, stage: f.stage })
  }
  assert.equal(isPickedUp(fold([ev(A, "040201", "2026-11-02T08:00:00.000Z")])), false, "040201 without possession")
  assert.equal(isPickedUp(fold([ev(A, "160102", "2026-11-02T08:00:00.000Z")])), true, "a problem with possession")
  assert.equal(isPickedUp(fold([ev(A, "040101", "2026-11-02T08:00:00.000Z"), ev(A, "040201", "2026-11-02T09:00:00.000Z")])), true, "possession of the first event stays")
})

test("returned stays sticky: 500610 then 190101 on one waybill stays returned", () => {
  const f = foldWaybill(entry(A), [ev(A, "500610", "2026-11-02T08:00:00.000Z"), ev(A, "190101", "2026-11-02T09:00:00.000Z")], NOW).entries[0]
  assert.deepEqual([f.stage, f.code, f.lastCode, f.done], ["returned", "500610", "190101", false])
  /* Also over two passes. */
  const g = foldWaybill(foldWaybill(entry(A), [ev(A, "500610", "2026-11-02T08:00:00.000Z")], NOW).entries[0], [ev(A, "190101", "2026-11-02T09:00:00.000Z")], NOW).entries[0]
  assert.equal(g.stage, "returned")
})

test("a return entry created by a repin still becomes delivered and ends polling", () => {
  const first = foldRow(row({ waybills: [C] }), new Map([[C, [ev(C, "230403", "2026-11-02T14:00:00.000Z", { data: repinData(R) })]]]), NOW)
  const stored = row({ waybills: first.waybills, tracking: first.tracking, stage: first.stage })
  const second = foldRow(stored, new Map([[R, [ev(R, "050101", "2026-11-03T08:00:00.000Z"), ev(R, "190101", "2026-11-04T08:00:00.000Z")]]]), NOW)
  assert.equal(second.tracking[0].stage, "delivered")
  assert.equal(second.stage, "returned", "a return under way or back is returned")
  assert.equal(trackingDone(row({ waybills: second.waybills, tracking: second.tracking, stage: second.stage }), NOW), true)
})

test("a repin of a waybill with no box keeps boxes and never throws", () => {
  const W3 = "0000000000303S"
  const boxes = { edited: false, items: [box(A), box(B)] }
  const repinOf = (from: string) => [ev(from, "230402", "2026-11-02T14:00:00.000Z", { data: [{ code: "01", description: null, value: R }] })]
  /* Three waybills, two boxes: the third has no box. */
  const third = foldRow(row({ waybills: [A, B, W3], boxes }), new Map([[W3, repinOf(W3)]]), NOW)
  assert.deepEqual(third.waybills, [A, B, R])
  assert.deepEqual(third.boxes, boxes)
  /* The second: only the box that carried it changes. */
  const second = foldRow(row({ waybills: [A, B, W3], boxes }), new Map([[B, repinOf(B)]]), NOW)
  assert.deepEqual(second.waybills, [A, R, W3])
  assert.deepEqual(second.boxes, { edited: false, items: [box(A), box(R)] })
  /* boxes null stays null. */
  assert.equal(foldRow(row({ waybills: [A], boxes: null }), new Map([[A, repinOf(A)]]), NOW).boxes, null)
})

test("rowStatus is the newest lastCode, superseded entries too; no events keep the stored status", () => {
  const entries = [entry(A, { lastCode: "170101", lastAt: "2026-11-02T08:00:00.000Z" }), entry(B, { lastCode: "230403", lastAt: "2026-11-02T09:00:00.000Z", supersededBy: R, description: "Zwrot" })]
  assert.deepEqual(rowStatus(entries), { status: "230403", statusAt: "2026-11-02T09:00:00.000Z", description: "Zwrot" })
  const f = foldRow(row({ status: "040101", status_at: new Date("2026-11-01T12:00:00.000Z") }), new Map(), NOW)
  assert.deepEqual([f.status, f.statusAt], ["040101", "2026-11-01T12:00:00.000Z"])
})

test("the README and the changelog describe unknown codes and in_point as the fold and the built in map give them", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..")
  const readme = readFileSync(join(root, "README.md"), "utf8")
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8")
  /* After 030103 an unknown code never lifts the stage: no doc may say an unknown code simply is "in transit". */
  const after = foldWaybill(entry(A), [ev(A, "030103", "2026-11-01T10:00:00.000Z"), ev(A, "040199", "2026-11-01T11:00:00.000Z")], NOW).entries[0]
  assert.deepEqual([after.stage, after.lastCode], ["preparing", "040199"])
  assert.equal(foldWaybill(entry(A), [ev(A, "040199", "2026-11-01T11:00:00.000Z")], NOW).entries[0].stage, "in_transit")
  for (const [name, text] of [["README", readme], ["CHANGELOG", changelog]] as const) {
    assert.doesNotMatch(text, /unknown code is "in transit"|does not know is "in transit"/, name)
  }
  assert.match(readme, /never replaces a stage set by a known code/)
  assert.match(changelog, /never replacing a stage a known code set/)
  /* No built in DPD code gives in_point: only the simulator's code, so live mode needs statusMap for it. */
  const inPoint = BUILTIN_CODE_RULES.filter((r) => r.stage === "in_point")
  assert.deepEqual(inPoint.map((r) => [r.codes, r.prefixes ?? [], r.source]), [[[SIM_IN_POINT], [], "sim"]])
  assert.match(readme, /In live mode `in_point` comes only from a `statusMap` entry/)
  assert.match(readme, /The example below runs in live mode only with a `statusMap` entry/)
  assert.match(changelog, /In live mode `in_point` comes only from `statusMap`/)
})
