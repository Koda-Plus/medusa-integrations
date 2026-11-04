/**
 * The status simulator of demo and the sandbox (6.7, 9.1): every variant on
 * its timeline at the minute boundaries, a stateless answer, the return
 * waybill, the PDF shape through the real parser, and no fetch at all.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { SIM_IN_POINT, WAYBILL_PATTERN } from "../src/modules/dpd/lib/constants.ts"
import { parseEventsResponse } from "../src/modules/dpd/lib/infoservices.ts"
import { buildCodeMap } from "../src/modules/dpd/lib/status-codes.ts"
import { SIM_BEFORE_HANDOVER, SIM_TIMELINES, simReturnWaybill, simulatedAnswer, simulatedEventsXml, simVariant, type SimRow, type SimVariant } from "../src/modules/dpd/lib/status-sim.ts"
import { createSqlStore } from "../src/modules/dpd/lib/store.ts"
import { repinCandidate } from "../src/modules/dpd/lib/tracking.ts"

const CREATED = "2026-11-02T08:00:00.000Z"
const HANDED = new Date("2026-11-02T10:00:00.000Z")
const MIN = 60_000

/** A synthetic waybill whose hash gives the wanted bucket of simVariant. */
function waybillFor(variant: Exclude<SimVariant, "pickup">): string {
  for (let i = 0; i < 100_000; i++) {
    const w = `99${String(i).padStart(11, "0")}D`
    const n = parseInt(createHash("sha256").update(w).digest("hex").slice(0, 8), 16) % 20
    const v = n === 0 || n === 1 ? "failed_attempt" : n === 2 ? "return" : "regular"
    if (v === variant) return w
  }
  throw new Error(`no waybill for ${variant}`)
}

function simRow(waybill: string, over: Partial<SimRow> = {}): SimRow {
  return { option_id: "dpd-courier", created_at: CREATED, handed_over_at: HANDED, waybills: [waybill], tracking: null, ...over }
}

const codesAt = (row: SimRow, waybill: string, now: Date) => {
  const a = simulatedAnswer(row, waybill, now)
  assert.equal(a.kind, "ok")
  return a.kind === "ok" ? a.value.events.map((e) => e.code) : []
}

test("each variant follows its timeline of 6.7", () => {
  const cases: Array<[SimVariant, string, string]> = [
    ["regular", waybillFor("regular"), "dpd-courier"],
    ["failed_attempt", waybillFor("failed_attempt"), "dpd-courier"],
    ["return", waybillFor("return"), "dpd-courier"],
    ["pickup", waybillFor("regular"), "dpd-pickup"],
  ]
  for (const [variant, w, option] of cases) {
    const row = simRow(w, { option_id: option })
    assert.equal(simVariant(w, option === "dpd-pickup"), variant)
    const outbound = SIM_TIMELINES[variant].filter((s) => s.leg === undefined)
    for (let i = 0; i < outbound.length; i++) {
      const step = outbound[i]
      const at = HANDED.getTime() + step.afterMin * MIN
      /* One minute before: not there yet; at the minute: there, newest first. */
      const before = codesAt(row, w, new Date(at - MIN))
      const now = codesAt(row, w, new Date(at))
      assert.deepEqual(now, [...outbound.slice(0, i + 1).map((s) => s.code)].reverse().concat(SIM_BEFORE_HANDOVER.code), `${variant} ${step.afterMin}`)
      assert.deepEqual(before, now.slice(1), `${variant} ${step.afterMin - 1}`)
    }
  }
  assert.deepEqual(SIM_TIMELINES.regular.map((s) => [s.afterMin, s.code]), [[30, "040101"], [90, "050101"], [240, "170101"], [360, "190101"]])
  assert.deepEqual(SIM_TIMELINES.failed_attempt.map((s) => [s.afterMin, s.code]), [[30, "040101"], [90, "050101"], [240, "170101"], [360, "200300"], [1440, "170101"], [1560, "190101"]])
  assert.deepEqual(SIM_TIMELINES.return.map((s) => [s.afterMin, s.code, s.leg ?? null]), [[30, "040101", null], [90, "050101", null], [240, "170101", null], [360, "230403", null], [720, "050101", "return"], [1440, "190101", "return"]])
  assert.deepEqual(SIM_TIMELINES.pickup.map((s) => [s.afterMin, s.code]), [[30, "040101"], [90, "050101"], [240, SIM_IN_POINT], [480, "190101"]])
})

test("before the handover only 030103 at created_at; a withdrawal goes back to it", () => {
  const w = waybillFor("regular")
  const late = new Date(HANDED.getTime() + 2000 * MIN)
  const a = simulatedAnswer(simRow(w, { handed_over_at: null }), w, late)
  assert.equal(a.kind, "ok")
  if (a.kind !== "ok") return
  assert.deepEqual(a.value.events.map((e) => [e.code, e.eventTime]), [["030103", CREATED]])
  assert.deepEqual(codesAt(simRow(w, { handed_over_at: null }), w, new Date(Date.parse(CREATED) - MIN)), [], "nothing before created_at")
})

test("simVariant spreads on the hash and gives pickup for both Pickup options", () => {
  for (const v of ["regular", "failed_attempt", "return"] as const) assert.equal(simVariant(waybillFor(v), false), v)
  const w = waybillFor("return")
  assert.equal(simVariant(w, true), "pickup")
  for (const option of ["dpd-pickup", "dpd-pickup-cod"]) {
    const row = simRow(w, { option_id: option })
    assert.ok(codesAt(row, w, new Date(HANDED.getTime() + 240 * MIN)).includes(SIM_IN_POINT), option)
  }
  assert.ok(!codesAt(simRow(w, { option_id: "unknown-option" }), w, new Date(HANDED.getTime() + 360 * MIN)).includes(SIM_IN_POINT), "an unknown option is a courier")
})

test("simReturnWaybill matches WAYBILL_PATTERN and starts with 9", () => {
  for (const w of [waybillFor("return"), waybillFor("regular"), "0000000000101S"]) {
    const r = simReturnWaybill(w)
    assert.match(r, WAYBILL_PATTERN)
    assert.match(r, /^9[0-9]{12}R$/)
    assert.notEqual(r, w)
    assert.equal(simReturnWaybill(w), r, "stable")
  }
})

test("the simulator answer goes through the real parser", () => {
  const w = waybillFor("return")
  const now = new Date(HANDED.getTime() + 400 * MIN)
  const xml = simulatedEventsXml(simRow(w), w, now)
  assert.match(xml, /^<S:Envelope xmlns:S="http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/">/)
  const a = parseEventsResponse(xml)
  assert.ok(a)
  assert.equal(a.confirmId, "0")
  assert.deepEqual(a.events.map((e) => e.code), ["230403", "170101", "050101", "040101", "030103"], "newest first")
  for (const e of a.events) {
    assert.deepEqual([e.waybill, e.objectId, e.depot, e.country, e.depotName], [w, null, "1305", "PL", "Warszawa"])
    assert.ok(e.description && e.description.length > 0)
    assert.match(e.eventTimeRaw, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  }
  /* 230403 carries the new waybill as entity CDATA, and nothing else carries any value. */
  assert.match(xml, new RegExp(`<value>&lt;!\\[CDATA\\[${simReturnWaybill(w)}\\]\\]&gt;</value>`))
  const values = a.events.flatMap((e) => e.data.map((d) => d.value))
  assert.deepEqual(values, [simReturnWaybill(w)])
  const repin = a.events[0]
  assert.deepEqual(repinCandidate(repin, buildCodeMap({}).lookup(repin.code)), { to: simReturnWaybill(w) })
  /* The time of the step, never now: 230403 at 360 min is 16:00Z, Warsaw wall time 17:00 in November. */
  assert.equal(a.events[0].eventTimeRaw, "2026-11-02T17:00:00")
  assert.equal(a.events[0].eventTime, "2026-11-02T16:00:00.000Z")
})

test("steps in the hour repeated at the end of summer time keep their order and are never read in the future", () => {
  /* 2026-10-25: 02:00 to 02:59 Warsaw time happens twice, 00:00Z to 01:00Z and 01:00Z to 02:00Z. */
  const w = waybillFor("regular")
  const steps = [SIM_BEFORE_HANDOVER.code, ...SIM_TIMELINES.regular.map((s) => s.code)]
  /* Created in the first of the two hours, and in the second one (030103 and 040101 then share the end of the hour). */
  for (const iso of ["2026-10-25T00:50:00.000Z", "2026-10-25T01:10:00.000Z"]) {
    const handedAt = new Date(iso)
    const r = simRow(w, { created_at: iso, handed_over_at: handedAt })
    for (let m = 0; m <= 150; m += 5) {
      const now = new Date(handedAt.getTime() + m * MIN)
      const parsed = parseEventsResponse(simulatedEventsXml(r, w, now))
      assert.ok(parsed)
      /* The order the fold reads: by eventTime, a tie in answer order. */
      const timed = parsed.events.map((e, i) => ({ code: e.code, i, t: Date.parse(e.eventTime ?? "") }))
      for (const x of timed) assert.ok(x.t <= now.getTime(), `${iso} +${m} min: ${x.code} read in the future`)
      const order = timed.sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.code)
      assert.deepEqual(order, steps.slice(0, order.length), `${iso} +${m} min`)
    }
  }
  const handed = new Date("2026-10-25T00:50:00.000Z")
  const row = simRow(w, { created_at: handed.toISOString(), handed_over_at: handed })
  /* 040101 at 01:20Z (02:20 CET) shows up when the repeated hour ends, at 02:00Z (03:00 CET). */
  const codes = (iso: string) => codesAt(row, w, new Date(iso))
  assert.deepEqual(codes("2026-10-25T01:59:00.000Z"), [SIM_BEFORE_HANDOVER.code])
  assert.deepEqual(codes("2026-10-25T02:00:00.000Z"), ["040101", SIM_BEFORE_HANDOVER.code])
  /* Any other day: the step at its own minute. */
  const plain = simRow(w, { created_at: "2026-10-26T00:50:00.000Z", handed_over_at: new Date("2026-10-26T00:50:00.000Z") })
  assert.deepEqual(codesAt(plain, w, new Date("2026-10-26T01:20:00.000Z")), ["040101", SIM_BEFORE_HANDOVER.code])
})

test("190101 carries milliseconds from the hash", () => {
  const w = waybillFor("regular")
  const a = simulatedAnswer(simRow(w), w, new Date(HANDED.getTime() + 360 * MIN))
  assert.equal(a.kind, "ok")
  if (a.kind !== "ok") return
  const delivered = a.value.events[0]
  assert.equal(delivered.code, "190101")
  const ms = String(parseInt(createHash("sha256").update(w).digest("hex").slice(8, 16), 16) % 1000).padStart(3, "0")
  assert.equal(delivered.eventTimeRaw, `2026-11-02T17:00:00.${ms}`)
})

test("a return waybill follows the return leg of its origin", () => {
  const w = waybillFor("return")
  const r = simReturnWaybill(w)
  const tracking = [
    { waybill: r, box: 0, role: "return", stage: "returned", possession: true, from: w },
    { waybill: w, box: 0, supersededBy: r },
  ]
  const row = simRow(w, { waybills: [r], tracking })
  assert.deepEqual(codesAt(row, r, new Date(HANDED.getTime() + 719 * MIN)), [])
  assert.deepEqual(codesAt(row, r, new Date(HANDED.getTime() + 720 * MIN)), ["050101"])
  assert.deepEqual(codesAt(row, r, new Date(HANDED.getTime() + 1440 * MIN)), ["190101", "050101"])
  const a = simulatedAnswer(row, r, new Date(HANDED.getTime() + 1440 * MIN))
  if (a.kind === "ok") assert.ok(a.value.events.every((e) => e.waybill === r && e.data.length === 0))
  /* The old waybill asked once more still gives its own timeline. */
  assert.equal(codesAt(row, w, new Date(HANDED.getTime() + 1440 * MIN))[0], "230403")
  /* A waybill with a from that is not its sim return waybill is an ordinary one. */
  const other = simRow(w, { waybills: ["0000000000302R"], tracking: [{ waybill: "0000000000302R", box: 0, role: "return", from: w }] })
  assert.equal(codesAt(other, "0000000000302R", new Date(HANDED.getTime() + 30 * MIN)).at(-1), "030103")
})

test("the same input gives the same answer and the simulator never calls fetch", () => {
  const original = globalThis.fetch
  globalThis.fetch = (() => {
    throw new Error("the simulator called fetch")
  }) as typeof fetch
  try {
    const w = waybillFor("failed_attempt")
    const now = new Date(HANDED.getTime() + 1600 * MIN)
    assert.equal(simulatedEventsXml(simRow(w), w, now), simulatedEventsXml(simRow(w), w, now))
    assert.deepEqual(simulatedAnswer(simRow(w), w, now), simulatedAnswer(simRow(w), w, now))
    const a = simulatedAnswer(simRow(w), w, now)
    assert.deepEqual(a.kind === "ok" && [a.httpStatus, a.ms], [200, 0])
  } finally {
    globalThis.fetch = original
  }
})

test("a seed row is never due", async () => {
  const seen: string[] = []
  const store = createSqlStore({
    sql: {
      async raw(sql: string) {
        seen.push(sql)
        return { rows: [] }
      },
    },
    newId: (p) => `${p}_1`,
  })
  await store.pickDueForStatus({ mode: "demo", now: new Date(), limit: 25, maxAgeDays: 30, spacingMin: 30, spacingBeforeHandoverMin: 120, writerBacklog: false, markStaleMs: 900_000 })
  assert.ok(seen[0].includes(`and not ("mode" = 'demo' and "fulfillment_id" is null)`))
  assert.ok(seen[0].includes(`"mode" <> 'demo'`), "no writer backlog in demo")
})
