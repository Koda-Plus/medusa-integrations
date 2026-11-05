/**
 * The courier order, pure (spec 5.1.4, 14.1): the calendar of Europe/Warsaw
 * across the change of time, the ranges of 11a, every code of the window
 * check, and validateCourierCall giving for the requests of 12d, 12g, 12h
 * and 12w the same refusal the classifier gives for DPD's answers to them.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addDays,
  COURIER_WINDOW_CODES,
  courierDays,
  courierOrdersOf,
  courierRangesOf,
  courierWindowProblems,
  isCourierTime,
  isIsoDate,
  parseCourierRange,
  validateCourierCall,
  warsawDate,
  warsawTime,
} from "../src/modules/dpd/lib/courier.ts"
import { classifyPickupCallAnswer, classifyPickupCallChangeAnswer } from "../src/modules/dpd/lib/dpd-answers.ts"
import type { DpdHttpAnswer, PackagesPickupCallCreateRequest } from "../src/modules/dpd/lib/dpdservices.ts"
import { loadFixture } from "./fake-dpdservices.ts"

function answerOf(name: string): DpdHttpAnswer {
  const f = loadFixture(name)
  return { httpStatus: f.response.httpStatus, body: f.response.body, text: "", traceId: null, ms: 0 }
}

/** The request of a courier fixture with the masked payer set to `payer` (its probe 1234 stays). */
function createOf(name: string, payer: number): PackagesPickupCallCreateRequest {
  const f = loadFixture(name)
  const body: PackagesPickupCallCreateRequest = JSON.parse(JSON.stringify(f.request.body).replace(/"number":"\*\*\*"/g, `"number":${payer}`))
  return body
}

test("warsaw date and time across the DST change", () => {
  /* 29 March 2026: 01:00 UTC is 03:00 CEST (the clock jumps from 02:00). */
  assert.equal(warsawTime(new Date("2026-03-29T00:59:00Z")), "01:59")
  assert.equal(warsawTime(new Date("2026-03-29T01:00:00Z")), "03:00")
  assert.equal(warsawDate(new Date("2026-03-28T23:30:00Z")), "2026-03-29")
  /* 25 October 2026: 01:00 UTC is 02:00 CET again (the clock goes back from 03:00). */
  assert.equal(warsawTime(new Date("2026-10-25T00:30:00Z")), "02:30")
  assert.equal(warsawTime(new Date("2026-10-25T01:30:00Z")), "02:30")
  assert.equal(warsawDate(new Date("2026-10-24T22:30:00Z")), "2026-10-25", "00:30 CEST is already the 25th")
  assert.equal(warsawDate(new Date("2026-11-03T22:59:00Z")), "2026-11-03")
  assert.equal(warsawDate(new Date("2026-11-03T23:00:00Z")), "2026-11-04", "midnight CET is 23:00 UTC")
  assert.equal(warsawTime(new Date("2026-11-03T23:00:00Z")), "00:00")
})

test("courier days are today and the next 14 days", () => {
  const days = courierDays(new Date("2026-12-24T23:30:00Z"))
  assert.equal(days.length, 15)
  assert.equal(days[0], "2026-12-25")
  assert.equal(days[14], "2027-01-08")
  assert.deepEqual(courierDays(new Date("2026-02-27T12:00:00Z"), 2), ["2026-02-27", "2026-02-28", "2026-03-01"])
  assert.equal(addDays("2028-02-28", 1), "2028-02-29")
  assert.equal(addDays("2026-03-01", -1), "2026-02-28")
  assert.ok(isIsoDate("2026-02-28") && !isIsoDate("2026-02-30") && !isIsoDate("2026-2-3") && !isIsoDate(20260203))
  assert.ok(isCourierTime("08:00") && isCourierTime("23:59") && !isCourierTime("8:00") && !isCourierTime("24:00") && !isCourierTime(800))
})

test("ranges of 11a parse to from, to and offset; an odd range keeps raw", () => {
  const body = loadFixture("11a-avail-02274").response.body
  const ranges = body !== null && typeof body === "object" && "ranges" in body ? body.ranges : null
  assert.deepEqual(courierRangesOf(ranges), [
    { from: "09:00", to: "17:00", offset: 360, raw: "09:00-17:00" },
    { from: "11:00", to: "14:00", offset: 180, raw: "11:00-14:00" },
    { from: "14:00", to: "17:00", offset: 180, raw: "14:00-17:00" },
  ])
  assert.deepEqual(courierRangesOf([{ range: " 08:00-16:00 ", offset: 1.5 }]), [{ from: "08:00", to: "16:00", offset: null, raw: " 08:00-16:00 " }], "raw is what DPD wrote; a fraction is no offset")
  assert.deepEqual(courierRangesOf([{ range: "17:00-09:00" }, { range: "9-17" }, { offset: 60 }, null, "09:00-10:00"]), [], "unreadable entries are dropped")
  assert.deepEqual(courierRangesOf(null), [])
  assert.deepEqual(parseCourierRange("08:00-16:00"), { from: "08:00", to: "16:00" })
  assert.equal(parseCourierRange("16:00-16:00"), null)
})

test("window problems: each COURIER_WINDOW_CODES code", () => {
  const today = "2026-11-03"
  const ranges = courierRangesOf([{ range: "09:00-17:00", offset: 360 }, { range: "11:00-14:00", offset: 180 }])
  const codes = (w: { pickupDate: string; pickupTimeFrom: string; pickupTimeTo: string }, r: typeof ranges | null = ranges) =>
    courierWindowProblems(w, r, today).map((p) => `${p.code}:${p.field}`)
  const seen = new Set<string>()
  const check = (got: string[], want: string[]) => {
    assert.deepEqual(got, want)
    for (const g of got) seen.add(g.split(":")[0])
  }
  check(codes({ pickupDate: "2026-11-04", pickupTimeFrom: "10:00", pickupTimeTo: "12:00" }), [])
  check(codes({ pickupDate: "2026-11-03", pickupTimeFrom: "09:00", pickupTimeTo: "17:00" }), [])
  check(codes({ pickupDate: "2026-11-17", pickupTimeFrom: "11:00", pickupTimeTo: "14:00" }), [])
  check(codes({ pickupDate: "2026-02-30", pickupTimeFrom: "10:00", pickupTimeTo: "12:00" }), ["date_invalid:pickupDate"])
  check(codes({ pickupDate: "2026-11-02", pickupTimeFrom: "10:00", pickupTimeTo: "12:00" }), ["date_past:pickupDate"])
  check(codes({ pickupDate: "2026-11-18", pickupTimeFrom: "10:00", pickupTimeTo: "12:00" }), ["date_too_far:pickupDate"])
  check(codes({ pickupDate: "2026-11-04", pickupTimeFrom: "8:00", pickupTimeTo: "12:00" }), ["time_invalid:pickupTimeFrom"])
  check(codes({ pickupDate: "2026-11-04", pickupTimeFrom: "12:00", pickupTimeTo: "10:00" }), ["time_order:pickupTimeTo"])
  check(codes({ pickupDate: "2026-11-04", pickupTimeFrom: "08:00", pickupTimeTo: "12:00" }), ["window_outside:pickupTimeFrom"])
  check(codes({ pickupDate: "2026-11-04", pickupTimeFrom: "10:00", pickupTimeTo: "12:00" }, []), ["no_ranges:pickupTimeFrom"])
  check(codes({ pickupDate: "2026-11-04", pickupTimeFrom: "08:00", pickupTimeTo: "12:00" }, null), [])
  assert.deepEqual([...seen].sort(), [...COURIER_WINDOW_CODES].sort())
})

test("validateCourierCall is shared by the flow and the simulator", () => {
  const today = "2026-11-03"
  const payerFid = 1000
  /* 12d (yesterday), 12g (51 kg), 12h (payer 1234): the refusal equals the classifier's for DPD's answer. */
  const d = { ...createOf("12d-order-yesterday", payerFid), pickupDate: "2026-11-02" }
  const cases: Array<[string, ReturnType<typeof validateCourierCall>]> = [
    ["12d-order-yesterday", validateCourierCall(d, { today, payerFid, op: "create" })],
    ["12g-order-maxweight-51", validateCourierCall({ ...createOf("12g-order-maxweight-51", payerFid), pickupDate: "2026-11-04" }, { today, payerFid, op: "create" })],
    ["12h-order-wrong-payer", validateCourierCall({ ...createOf("12h-order-wrong-payer", payerFid), pickupDate: "2026-11-04" }, { today, payerFid, op: "create" })],
  ]
  for (const [name, local] of cases) {
    const dpd = classifyPickupCallAnswer(answerOf(name))
    assert.ok(local && local.kind === "refused" && dpd.kind === "refused", name)
    if (!local || dpd.kind !== "refused") continue
    assert.equal(local.code, dpd.code, name)
    assert.equal(local.httpStatus, dpd.httpStatus, name)
    assert.deepEqual(local.problems, dpd.problems, name)
  }
  /* 12w: a checkSum of three characters in DELETE. */
  const w = validateCourierCall({ orderNumber: "SBX00000000001", checkSum: "123" }, { today, payerFid, op: "delete" })
  const dpdW = classifyPickupCallChangeAnswer(answerOf("12w-delete-short-checksum"), "delete")
  assert.ok(w && dpdW.kind === "refused")
  if (w && dpdW.kind === "refused") {
    assert.deepEqual([w.kind, w.code, w.httpStatus, w.problems], [dpdW.kind, dpdW.code, dpdW.httpStatus, dpdW.problems])
  }
  /* A side over 300 cm is refused too; a valid body passes; the payer is not checked on a change. */
  const ok = { ...createOf("12a-order", payerFid), pickupDate: "2026-11-04" }
  assert.equal(validateCourierCall(ok, { today, payerFid, op: "create" }), null)
  const tall = { ...ok, packagesForCollection: { ...ok.packagesForCollection, packagesParams: { doxCount: 0 as const, parcel: { ...ok.packagesForCollection.packagesParams.parcel, maxHeight: 301 } } } }
  const side = validateCourierCall(tall, { today, payerFid, op: "create" })
  assert.equal(side?.code, "validation")
  assert.deepEqual(side?.problems, [{ code: "dpd_validation", field: "packagesForCollection.packagesParams.parcel.maxHeight", detail: "must be less than or equal to 300" }])
  assert.equal(validateCourierCall({ orderNumber: "SBX00000000001", checkSum: "12345678" }, { today, payerFid, op: "delete" }), null)
  assert.equal(validateCourierCall({ orderNumber: "SBX00000000001", checkSum: "x".repeat(37) }, { today, payerFid, op: "delete" })?.code, "checksum")
})

test("courierOrdersOf gives demo, simulated, dpd", () => {
  assert.equal(courierOrdersOf({ demo: true, mode: "live" }), "demo")
  assert.equal(courierOrdersOf({ demo: true, mode: "sandbox" }), "demo")
  assert.equal(courierOrdersOf({ demo: false, mode: "sandbox" }), "simulated")
  assert.equal(courierOrdersOf({ demo: false, mode: "live" }), "dpd")
})
