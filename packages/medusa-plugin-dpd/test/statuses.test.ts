/**
 * The status pass of stage 5 (flow): the claim and its order, the call
 * limit, the source off, the login problem, the compare and set, the events
 * of a stage change, repins, the history without receiver data, the
 * retention, a refresh, demo, and the writer backlog of 6.19. InfoServices is
 * the fake behind createInfoServicesClient, the Medusa core flows are
 * fakeCoreFlows, the store is the memory store. No network.
 */
import { afterEach, beforeEach, mock, test } from "node:test"
import assert from "node:assert/strict"
import { STATUS_BATCH_WAYBILLS, STATUS_PASS_BUDGET_MS, STATUS_WRITER_MIN_ROWS, STATUS_WRITER_RESERVE_MS } from "../src/modules/dpd/lib/constants.ts"
import { countsOf, rowGroup, type ShipmentRow } from "../src/modules/dpd/lib/dto.ts"
import { parseEventsResponse } from "../src/modules/dpd/lib/infoservices.ts"
import { buildCodeMap } from "../src/modules/dpd/lib/status-codes.ts"
import { ensureDemoSeed } from "../src/workflows/dpd/demo.ts"
import { createDispatch, planDispatch, withdrawShipment } from "../src/workflows/dpd/dispatch.ts"
import { statusReaderFor, type StatusReader } from "../src/workflows/dpd/runtime.ts"
import { refreshRow, refreshShipmentStatus, releaseStaleMarks, runStatusPass, WRITER_INTERRUPTED_MESSAGE, type StatusContext } from "../src/workflows/dpd/statuses.ts"
import { eventsXml } from "./fake-infoservices.ts"
import { arm, insertLabeled, labeledOrder, LIVE_INFO, order, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

const realFetch = globalThis.fetch
let requests = 0
beforeEach(() => {
  requests = 0
  globalThis.fetch = (async () => {
    requests += 1
    throw new Error("no network in the tests")
  }) as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  assert.equal(requests, 0, "only the fake InfoServices is ever called")
})

const ADMIN = "user_01ADMIN"
const MIN = 60_000
const DAY = 86_400_000
const T0 = new Date("2026-11-03T12:00:00.000Z")
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN)
/** Live with the status writer allowed (armed per test). */
const LIVE = { ...LIVE_INFO, fulfillmentStatusWriter: true }
/** A waybill that matches WAYBILL_PATTERN, for repins. */
const NEW_WAYBILL = "1000000000001U"

/** One event of the fake InfoServices; `at` is Warsaw wall time as DPD sends it. */
type Ev = { code: string; at: string; data?: Array<{ code: string; value: string }>; description?: string }
/** What DPD knows per waybill: its events, a refused login or an unclear answer. */
type Dpd = Map<string, Ev[] | "auth" | "unclear">

function live(dpd: Dpd, options = LIVE): Setup {
  return setup(options, [], {
    info: (req) => {
      const known = dpd.get(req.waybill ?? "")
      if (known === "auth") return { fixture: "13f-wrong-password.response.xml" }
      if (known === "unclear") return { status: 503, body: "Service Unavailable" }
      return {
        body: eventsXml((known ?? []).map((e) => ({ waybill: req.waybill ?? "", code: e.code, eventTimeRaw: e.at, description: e.description ?? `Event ${e.code}`, data: e.data }))),
      }
    },
  })
}

const wb = (i: number) => `0000${String(i).padStart(4, "0")}0000U`
const wb2 = (i: number) => `1111${String(i).padStart(4, "0")}1111U`

/** A labeled row handed over two hours before T0 (stage ready), never asked. */
function handed(s: Setup, i: number, over: Partial<ShipmentRow> = {}): Row {
  return insertLabeled(s, labeledOrder(i), { created_at: new Date(T0.getTime() - DAY), handed_over_at: at(-120), stage: "ready", ...over } as Partial<ShipmentRow>)
}

/** The same with two boxes and two waybills. */
function handedTwo(s: Setup, i: number, over: Partial<ShipmentRow> = {}): Row {
  const box = (waybill: string, n: number) => ({ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10, reference: `ful_01HAND${i}-${n}`, waybill })
  return handed(s, i, { waybills: [wb(i), wb2(i)], boxes: { edited: false, items: [box(wb(i), 1), box(wb2(i), 2)] }, ...over } as Partial<ShipmentRow>)
}

function stored(s: Setup, id: unknown): Row {
  const row = s.shipments.rows.find((r) => r.id === id)
  assert.ok(row)
  return row
}

const ms = (v: unknown) => (v instanceof Date ? v.getTime() : v === null || v === undefined ? null : new Date(String(v)).getTime())
const asked = (s: Setup, from = 0) => s.infoCalls.slice(from).map((c) => String(c.waybill))
const actionsOf = (s: Setup, id: unknown) => s.events.rows.filter((e) => e.shipment_id === id && e.kind === "action").map((e) => String((e.data as Row | null)?.action ?? ""))
const statusEvents = (s: Setup) => s.events.rows.filter((e) => e.kind === "status")
const names = (s: Setup) => s.emitted.map((e) => e.name).filter((n) => n !== "dpd.shipment.created")
const flows = (s: Setup) => s.coreFlows.calls.map((c) => c.flow)

function ctxOf(s: Setup, now: Date): StatusContext {
  const reader = statusReaderFor(s.container)
  assert.ok(reader)
  return { reader, map: buildCodeMap(s.options.statusMap), now, callsLeft: { n: STATUS_BATCH_WAYBILLS }, deadline: Date.now() + 60_000, actor: "system", trigger: "pass" }
}

/* ------------------------------------------------------------------ */
/* The claim                                                           */
/* ------------------------------------------------------------------ */

test("a pass claims due rows and asks each live waybill once", async () => {
  const dpd: Dpd = new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]])
  const s = live(dpd)
  const one = handed(s, 1)
  const two = handedTwo(s, 2)
  const early = handed(s, 3, { handed_over_at: null, stage: "preparing", last_checked_at: at(-60) } as Partial<ShipmentRow>)
  const r = await runStatusPass(s.container, T0)
  assert.equal(r.ran, true)
  assert.equal(r.source, "dpd")
  assert.equal(r.picked, 2, "the row before its handover was asked an hour ago: not due yet")
  assert.equal(r.asked, 3)
  assert.equal(r.newEvents, 1)
  assert.deepEqual(asked(s).sort(), [wb(1), wb(2), wb2(2)].sort())
  assert.equal(ms(stored(s, one.id).last_checked_at), T0.getTime())
  assert.equal(ms(stored(s, two.id).last_checked_at), T0.getTime())
  assert.equal(ms(stored(s, early.id).last_checked_at), at(-60).getTime())
  assert.equal(stored(s, one.id).stage, "in_transit")
  const [event] = statusEvents(s)
  assert.equal(event.waybill, wb(1))
  assert.equal(event.status, "040101")
  assert.equal(event.source, "dpd")
  assert.equal(new Date(String(event.occurred_at)).toISOString(), "2026-11-03T10:00:00.000Z", "Warsaw wall time read as UTC")
  const sync = s.settings.rows.find((x) => x.key === "live:status:lastSyncAt")
  assert.deepEqual({ ...(sync?.value as Row), at: null }, { at: null, source: "dpd", asked: 3, newEvents: 1 })

  const again = await runStatusPass(s.container, at(5))
  assert.equal(again.picked, 0, "spaced by STATUS_SPACING_MIN")
  assert.equal(s.infoCalls.length, 3)
})

test("rows cut by the call limit get their last_checked_at back and come first in the next pass", async () => {
  const s = live(new Map())
  const rows = Array.from({ length: 50 }, (_, i) => handedTwo(s, i + 1))
  const first = await runStatusPass(s.container, at(35))
  assert.equal(first.picked, 50)
  assert.equal(first.asked, STATUS_BATCH_WAYBILLS)
  assert.equal(first.stoppedBy, "limit")
  const checked = rows.filter((r) => ms(stored(s, r.id).last_checked_at) === at(35).getTime())
  const back = rows.filter((r) => stored(s, r.id).last_checked_at === null)
  assert.equal(checked.length, 25)
  assert.equal(back.length, 25, "E3: the claim of the rows not reached is given back")

  const second = await runStatusPass(s.container, at(40))
  assert.equal(second.picked, 25, "the rows given back come first; the asked ones are spaced")
  assert.equal(second.asked, 50)
  assert.equal(second.stoppedBy, null)
  for (const r of checked) assert.equal(ms(stored(s, r.id).last_checked_at), at(35).getTime())
  for (const r of back) assert.equal(ms(stored(s, r.id).last_checked_at), at(40).getTime())
  assert.equal(s.infoCalls.length, 100)
  assert.equal(new Set(asked(s)).size, 100, "each waybill asked once over the two passes")
})

test("a row cut by the call limit goes on with the waybills it did not ask in the next pass", async () => {
  const count = STATUS_BATCH_WAYBILLS + 10
  const waybills = Array.from({ length: count }, (_, i) => wb(i + 1))
  const s = live(new Map(waybills.map((w) => [w, [{ code: "040101", at: "2026-11-03 11:00:00" }]])))
  const box = (waybill: string, n: number) => ({ weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10, reference: `ful_01MANY-${n}`, waybill })
  const many = handed(s, 1, { waybills, boxes: { edited: false, items: waybills.map((w, n) => box(w, n + 1)) } } as Partial<ShipmentRow>)

  const first = await runStatusPass(s.container, T0)
  assert.equal(first.asked, STATUS_BATCH_WAYBILLS, "the call limit cuts the row inside")
  assert.deepEqual(asked(s), waybills.slice(0, STATUS_BATCH_WAYBILLS))
  assert.equal(stored(s, many.id).stage, "ready", "10 waybills not asked yet count as ready (rule 4)")

  const from = s.infoCalls.length
  const second = await runStatusPass(s.container, at(35))
  assert.equal(second.asked, STATUS_BATCH_WAYBILLS)
  assert.deepEqual(asked(s, from).slice(0, 10), waybills.slice(STATUS_BATCH_WAYBILLS), "the waybills never asked come first")
  assert.equal(new Set(asked(s)).size, count, "every waybill asked within two passes")
  assert.equal(stored(s, many.id).stage, "in_transit")
  assert.ok(names(s).includes("dpd.shipment.status_changed"))
})

test("a pass in live without credentials does not run (source off)", async () => {
  const s = setup({ ...SANDBOX, mode: "live" })
  const row = handed(s, 1)
  const r = await runStatusPass(s.container, T0)
  assert.equal(r.ran, false)
  assert.equal(r.source, "off")
  assert.equal(r.picked, 0)
  assert.equal(stored(s, row.id).last_checked_at ?? null, null, "nothing claimed")
  assert.equal(s.settings.rows.some((x) => x.key === "live:status:lastSyncAt"), false)
})

test("auth stops the pass and records statuses_auth; the next ok clears it", async () => {
  const dpd: Dpd = new Map([[wb(1), "auth"]])
  const s = live(dpd)
  const one = handed(s, 1)
  const two = handed(s, 2)
  const r = await runStatusPass(s.container, T0)
  assert.equal(r.stoppedBy, "auth")
  assert.equal(r.asked, 1)
  assert.deepEqual(asked(s), [wb(1)])
  assert.equal(ms(stored(s, one.id).last_checked_at), T0.getTime())
  assert.equal(stored(s, two.id).last_checked_at, null, "the row not reached gets its claim back")
  const problem = s.settings.rows.find((x) => x.key === "live:status:problem")
  assert.equal((problem?.value as Row | undefined)?.code, "statuses_auth")
  assert.ok(s.logs.some((l) => l.startsWith("error ") && l.includes("InfoServices refused the login")))
  for (const secret of ["info-password-koda-0000", "koda-info-test", "<authDataV1>", "https://"]) {
    assert.ok(!s.logs.join("\n").includes(secret), secret)
    assert.ok(!JSON.stringify(s.events.rows).includes(secret), secret)
  }

  dpd.set(wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }])
  const next = await runStatusPass(s.container, at(31))
  assert.equal(next.stoppedBy, null)
  assert.equal(s.settings.rows.some((x) => x.key === "live:status:problem"), false, "an answered call clears the problem")
})

/* ------------------------------------------------------------------ */
/* The compare and set and the events                                  */
/* ------------------------------------------------------------------ */

test("a lost compare and set writes nothing and emits nothing", async () => {
  const s = live(new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]]))
  const row = handed(s, 1)
  const read = { ...stored(s, row.id) } as unknown as ShipmentRow
  /* Another call wrote the row after this read. */
  Object.assign(stored(s, row.id), { status: "030103" })
  const run = await refreshRow(s.container, read, ctxOf(s, T0))
  assert.equal(run.answered, 1)
  assert.equal(run.changed, false)
  assert.equal(run.stageChanged, false)
  assert.equal(stored(s, row.id).stage, "ready")
  assert.equal(stored(s, row.id).tracking ?? null, null)
  assert.deepEqual(names(s), [])
})

test("status_changed carries previous_stage and the dpd_event id of the event that set the stage", async () => {
  const s = live(new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]]))
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  assert.deepEqual(names(s), ["dpd.shipment.status_changed"])
  const data = s.emitted.find((e) => e.name === "dpd.shipment.status_changed")?.data
  assert.ok(data)
  assert.equal(data.id, row.id)
  assert.equal(data.stage, "in_transit")
  assert.equal(data.previous_stage, "ready")
  assert.equal(data.status, "040101")
  assert.equal(data.previous_status, null)
  const [event] = statusEvents(s)
  assert.equal(data.event_id, event.id)
})

test("delivered comes right after its status_changed and only for delivered", async () => {
  const dpd: Dpd = new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]])
  const s = live(dpd)
  handed(s, 1)
  await runStatusPass(s.container, T0)
  assert.deepEqual(names(s), ["dpd.shipment.status_changed"])
  dpd.set(wb(1), [
    { code: "040101", at: "2026-11-03 11:00:00" },
    { code: "190101", at: "2026-11-03 13:20:00" },
  ])
  await runStatusPass(s.container, at(31))
  assert.deepEqual(names(s), ["dpd.shipment.status_changed", "dpd.shipment.status_changed", "dpd.shipment.delivered"])
  const [, changed, delivered] = s.emitted.filter((e) => e.name !== "dpd.shipment.created")
  assert.deepEqual(delivered.data, changed.data)
  assert.equal(delivered.data.stage, "delivered")
  assert.equal(delivered.data.previous_stage, "in_transit")
  assert.deepEqual(flows(s), [], "the writer is not armed")
})

test("the event payload has exactly the 17 keys of DpdShipmentEvent", async () => {
  const s = live(new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]]))
  handed(s, 1, { option_id: "dpd-courier-cod", cod_minor: 19999, currency: "PLN" } as Partial<ShipmentRow>)
  await runStatusPass(s.container, T0)
  const data = s.emitted.find((e) => e.name === "dpd.shipment.status_changed")?.data
  assert.ok(data)
  assert.deepEqual(Object.keys(data).sort(), [
    "cod", "country_code", "demo", "event_id", "fulfillment_id", "id", "kind", "mode", "option_id",
    "order_id", "previous_stage", "previous_status", "pudo_id", "return_id", "stage", "status", "waybills",
  ])
  assert.deepEqual(data.cod, { amount: "199.99", currency: "PLN" })
  assert.equal(data.mode, "live")
  assert.equal(data.demo, false)
  assert.deepEqual(data.waybills, [wb(1)])
})

test("a failed emit is logged and the row stays changed", async () => {
  const s = live(new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]]))
  const row = handed(s, 1)
  s.emitFails = true
  const r = await runStatusPass(s.container, T0)
  assert.equal(r.stageChanges, 1)
  assert.equal(stored(s, row.id).stage, "in_transit")
  assert.deepEqual(s.emitted, [])
  assert.ok(s.logs.some((l) => l.startsWith("warn ") && l.includes("dpd.shipment.status_changed") && l.includes("event bus down")))
})

/* ------------------------------------------------------------------ */
/* The handover and a withdrawal (DS12, E27, O18)                      */
/* ------------------------------------------------------------------ */

async function demoHandedOver(): Promise<{ s: Setup; id: string }> {
  const s = setup({ demo: true }, [])
  arm(s, "shipment")
  arm(s, "pickup")
  const id = String(insertLabeled(s, labeledOrder(1)).id)
  const { plan } = await planDispatch(s.container, [id])
  const view = await createDispatch(s.container, { shipmentIds: [id], planHash: plan.hash, print: true }, { actor: ADMIN })
  assert.equal(view.dispatch.state, "printed", String(view.dispatch.error))
  return { s, id }
}

test("the handover sets ready without an event", async () => {
  const { s, id } = await demoHandedOver()
  assert.equal(stored(s, id).stage, "ready")
  assert.ok(stored(s, id).handed_over_at)
  assert.deepEqual(names(s), [], "ready comes from the handover, not from DPD (O18)")
})

test("a pass that read a stage 4 row before its withdrawal loses the compare and set", async () => {
  const { s, id } = await demoHandedOver()
  /* A row of stage 4: handed over, no stage yet. */
  Object.assign(stored(s, id), { stage: null })
  const read = { ...stored(s, id) } as unknown as ShipmentRow
  await withdrawShipment(s.container, id, { actor: ADMIN })
  assert.equal(stored(s, id).stage, "preparing")
  const now = new Date(Date.now() + 60 * MIN)
  const run = await refreshRow(s.container, read, ctxOf(s, now))
  assert.ok(run.answered > 0, "the simulator answered from the stale read")
  assert.equal(run.changed, false)
  assert.equal(stored(s, id).stage, "preparing")
  assert.equal(stored(s, id).handed_over_at, null)
  await runStatusPass(s.container, now)
  assert.equal(stored(s, id).stage, "preparing")
  assert.deepEqual(names(s), [], "no status_changed for the parcel that never left")
})

/** A reader that answers every waybill with these events, as DPD would (the stage past ready of 0402xx needs DPD, the simulator never sends it). */
function readerOf(events: Ev[]): StatusReader {
  return {
    source: "dpd",
    events: async (_row, waybill) => {
      const value = parseEventsResponse(eventsXml(events.map((e) => ({ waybill, code: e.code, eventTimeRaw: e.at, description: `Event ${e.code}` }))))
      assert.ok(value)
      return { kind: "ok", value, httpStatus: 200, ms: 0 }
    },
  }
}

test("a pass that read a problem row before its withdrawal loses the compare and set (O17, O53)", async () => {
  const { s, id } = await demoHandedOver()
  const failed: Ev = { code: "040201", at: "2026-11-03 10:00:00" }
  const now = new Date(Date.now() + 60 * MIN)
  /* A failed pickup without possession: problem, still withdrawable (O53). */
  const first = await refreshRow(s.container, { ...stored(s, id) } as unknown as ShipmentRow, { ...ctxOf(s, now), reader: readerOf([failed]) })
  assert.equal(first.changed, true)
  assert.equal(stored(s, id).stage, "problem")
  const before = names(s).length
  const read = { ...stored(s, id) } as unknown as ShipmentRow
  await withdrawShipment(s.container, id, { actor: ADMIN })
  assert.equal(stored(s, id).stage, "problem", "a stage past ready stays on a withdrawal")
  assert.equal(stored(s, id).handed_over_at, null)
  /* A later preparing event: folded with the stale handover it would give ready. */
  const run = await refreshRow(s.container, read, { ...ctxOf(s, now), reader: readerOf([failed, { code: "030103", at: "2026-11-03 11:30:00" }]) })
  assert.ok(run.answered > 0)
  assert.equal(run.changed, false, "the handover changed after the read")
  assert.equal(run.stageChanged, false)
  assert.equal(stored(s, id).stage, "problem")
  assert.equal(stored(s, id).dispatch_id, null)
  assert.equal(names(s).length, before, "no status_changed from the stale read")
  /* A fresh read folds without the handover: preparing, never ready. */
  await refreshRow(s.container, { ...stored(s, id) } as unknown as ShipmentRow, { ...ctxOf(s, now), reader: readerOf([failed, { code: "030103", at: "2026-11-03 11:30:00" }]) })
  assert.equal(stored(s, id).stage, "preparing")
})

test("a pass that read a problem row before its handover loses the compare and set (O17)", async () => {
  const s = setup({ demo: true }, [])
  arm(s, "shipment")
  arm(s, "pickup")
  const id = String(insertLabeled(s, labeledOrder(1)).id)
  const failed: Ev = { code: "040201", at: "2026-11-03 10:00:00" }
  const now = new Date(Date.now() + 60 * MIN)
  await refreshRow(s.container, { ...stored(s, id) } as unknown as ShipmentRow, { ...ctxOf(s, now), reader: readerOf([failed]) })
  assert.equal(stored(s, id).stage, "problem")
  const read = { ...stored(s, id) } as unknown as ShipmentRow
  const { plan } = await planDispatch(s.container, [id])
  const view = await createDispatch(s.container, { shipmentIds: [id], planHash: plan.hash, print: true }, { actor: ADMIN })
  assert.equal(view.dispatch.state, "printed", String(view.dispatch.error))
  assert.equal(stored(s, id).stage, "problem", "a stage DPD reported stays on the handover")
  assert.ok(stored(s, id).handed_over_at)
  const before = names(s).length
  /* Folded with the stale read (no handover) it would give preparing on a handed over row. */
  const run = await refreshRow(s.container, read, { ...ctxOf(s, now), reader: readerOf([failed, { code: "030103", at: "2026-11-03 11:30:00" }]) })
  assert.equal(run.changed, false)
  assert.equal(stored(s, id).stage, "problem")
  assert.equal(names(s).length, before, "no status_changed from the stale read")
})

/* ------------------------------------------------------------------ */
/* Repins (DS3, E2, E11)                                               */
/* ------------------------------------------------------------------ */

const REDIRECT: Ev[] = [
  { code: "040101", at: "2026-11-03 10:00:00" },
  { code: "230402", at: "2026-11-03 11:00:00", data: [{ code: "01", value: NEW_WAYBILL }] },
]

test("a repin swaps the waybill in place, asks the old one once more and updates dpd_waybills", async () => {
  const s = live(new Map([[wb(1), REDIRECT]]))
  const row = handed(s, 1)
  const r = await runStatusPass(s.container, T0)
  assert.equal(r.repins, 1)
  const after = stored(s, row.id)
  assert.deepEqual(after.waybills, [NEW_WAYBILL])
  assert.equal((after.boxes as { items: Row[] }).items[0].waybill, NEW_WAYBILL)
  const tracking = after.tracking as Row[]
  assert.equal(tracking.find((e) => e.waybill === wb(1))?.supersededBy, NEW_WAYBILL)
  assert.equal(tracking.find((e) => e.waybill === NEW_WAYBILL)?.from, wb(1))
  assert.deepEqual(s.fulfillments.get(String(row.fulfillment_id))?.data.dpd_waybills, [NEW_WAYBILL])
  const repin = s.events.rows.find((e) => (e.data as Row | null)?.action === "repin")
  assert.ok(repin)
  assert.deepEqual({ ...(repin.data as Row) }, { action: "repin", from: wb(1), to: NEW_WAYBILL, code: "230402", box: 0, role: "outbound", eventTime: "2026-11-03 11:00:00" })
  /* The Panel search still finds it by the number on its label and the handover protocol, and by the new one. */
  for (const q of [wb(1), NEW_WAYBILL]) {
    const found = await s.store.list({ mode: "live", filter: "all", q, offset: 0, limit: 10 })
    assert.deepEqual(found.rows.map((x) => x.id), [row.id], q)
  }
  const none = await s.store.list({ mode: "live", filter: "all", q: "Event 230402", offset: 0, limit: 10 })
  assert.equal(none.count, 0, "only the waybill of a tracking entry is searched")

  const before = s.infoCalls.length
  await runStatusPass(s.container, at(31))
  assert.deepEqual(asked(s, before).sort(), [NEW_WAYBILL, wb(1)].sort(), "the old waybill once more")
  const later = s.infoCalls.length
  await runStatusPass(s.container, at(62))
  assert.deepEqual(asked(s, later), [NEW_WAYBILL])
})

test("the old waybill asked once more is not repinned again: one repin history, waybills written once, annotateFulfillment once", async () => {
  const s = live(new Map([[wb(1), REDIRECT]]))
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  await runStatusPass(s.container, at(31))
  const second = await runStatusPass(s.container, at(62))
  assert.equal(second.repins, 0)
  assert.equal(actionsOf(s, row.id).filter((a) => a === "repin").length, 1)
  assert.deepEqual(stored(s, row.id).waybills, [NEW_WAYBILL])
  assert.equal(s.fulfillmentUpdates.length, 1, "dpd_waybills written once")
})

test("the new waybill of a redirect answering its own 030103 keeps the row in_transit and emits no status_changed back to ready (E60)", async () => {
  const dpd: Dpd = new Map([[wb(1), REDIRECT]])
  const s = live(dpd)
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  assert.equal(stored(s, row.id).stage, "in_transit")
  assert.deepEqual(names(s), ["dpd.shipment.status_changed"])
  dpd.set(NEW_WAYBILL, [{ code: "030103", at: "2026-11-03 12:05:00" }])
  await runStatusPass(s.container, at(31))
  assert.equal(stored(s, row.id).stage, "in_transit")
  assert.equal(stored(s, row.id).status, "030103", "the status shows the newest event")
  assert.deepEqual(names(s), ["dpd.shipment.status_changed"], "no stage change, no event")
})

test("a repin whose dpd_waybills write failed is written by the next pass (E57)", async () => {
  const s = live(new Map([[wb(1), REDIRECT]]))
  const row = handed(s, 1)
  const fid = String(row.fulfillment_id)
  s.fulfillmentFaults.update.add(fid)
  await runStatusPass(s.container, T0)
  assert.deepEqual(stored(s, row.id).waybills, [NEW_WAYBILL])
  assert.notDeepEqual(s.fulfillments.get(fid)?.data.dpd_waybills, [NEW_WAYBILL], "the failed write left the old waybill")
  s.fulfillmentFaults.update.delete(fid)
  await runStatusPass(s.container, at(31))
  assert.deepEqual(s.fulfillments.get(fid)?.data.dpd_waybills, [NEW_WAYBILL])
  assert.equal(actionsOf(s, row.id).filter((a) => a === "repin").length, 1)
  await runStatusPass(s.container, at(62))
  assert.equal(s.fulfillmentUpdates.length, 1, "written once, then the compare returns early")
})

test("a restart after the compare and set of a repin loses neither the repin history nor dpd_waybills (E57)", async () => {
  const s = live(new Map([[wb(1), REDIRECT]]))
  const row = handed(s, 1)
  const fid = String(row.fulfillment_id)
  const before = structuredClone(s.fulfillments.get(fid)?.data)
  await runStatusPass(s.container, T0)
  /* What a restart right after applyTracking leaves: the row repinned, no repin history, dpd_waybills as before. */
  s.events.rows = s.events.rows.filter((e) => (e.data as Row | null)?.action !== "repin")
  const f = s.fulfillments.get(fid)
  assert.ok(f)
  f.data = structuredClone(before ?? {})
  const second = await runStatusPass(s.container, at(31))
  assert.equal(second.repins, 0, "no new repin: the old waybill brings the same one again")
  const repins = s.events.rows.filter((e) => e.shipment_id === row.id && (e.data as Row | null)?.action === "repin")
  assert.equal(repins.length, 1)
  assert.deepEqual({ ...(repins[0].data as Row) }, { action: "repin", from: wb(1), to: NEW_WAYBILL, code: "230402", box: 0, role: "outbound", eventTime: "2026-11-03 11:00:00" })
  assert.deepEqual(s.fulfillments.get(fid)?.data.dpd_waybills, [NEW_WAYBILL])
  assert.deepEqual(stored(s, row.id).waybills, [NEW_WAYBILL])
})

test("status_changed of a two waybill row carries the id of the newest event inserted now at the new stage", async () => {
  const s = live(
    new Map([
      [wb(1), [{ code: "040101", at: "2026-11-03 10:00:00" }]],
      [wb2(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]],
    ]),
  )
  handedTwo(s, 1)
  await runStatusPass(s.container, T0)
  const newest = statusEvents(s).find((e) => e.waybill === wb2(1))
  assert.ok(newest)
  const data = s.emitted.find((e) => e.name === "dpd.shipment.status_changed")?.data
  assert.equal(data?.event_id, newest.id)
})

test("eventDataList values and the receiver description never reach dpd_event", async () => {
  const s = live(
    new Map([
      [
        wb(1),
        [
          {
            code: "190101",
            at: "2026-11-03 11:00:00",
            description: "Przesyłka doręczona",
            data: [
              { code: "01", value: "Anna Kowalska" },
              { code: "02", value: "ul. Tajna 7, Warszawa" },
            ],
          },
        ],
      ],
    ]),
  )
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  assert.equal(stored(s, row.id).stage, "delivered")
  const everything = JSON.stringify([s.events.rows, s.shipments.rows, s.emitted, s.logs, s.settings.rows])
  for (const personal of ["Anna Kowalska", "Tajna", "eventDataList"]) assert.ok(!everything.includes(personal), personal)
  const [event] = statusEvents(s)
  assert.deepEqual(Object.keys(event.data as Row).sort(), ["country", "depot", "depotName", "eventTime"])
})

/* ------------------------------------------------------------------ */
/* Retention, refresh, demo                                            */
/* ------------------------------------------------------------------ */

test("status events of rows no longer asked are pruned after 120 days, actions never", async () => {
  const s = live(new Map())
  const done = handed(s, 1, { stage: "delivered" } as Partial<ShipmentRow>)
  const asking = handed(s, 2)
  const event = (shipment: Row, kind: string, daysAgo: number) =>
    s.events.insert({ shipment_id: shipment.id, order_id: shipment.order_id, kind, status: kind === "status" ? "040101" : null, mode: "live", occurred_at: new Date(T0.getTime() - daysAgo * DAY) })
  const old = event(done, "status", 121)
  const recent = event(done, "status", 10)
  const kept = event(asking, "status", 121)
  const action = event(done, "action", 121)
  const r = await runStatusPass(s.container, T0)
  assert.equal(r.pruned, 1)
  const ids = s.events.rows.map((e) => e.id)
  assert.ok(!ids.includes(old.id))
  for (const e of [recent, kept, action]) assert.ok(ids.includes(e.id))
  assert.ok(s.settings.rows.some((x) => x.key === "live:status:prunedAt"))

  event(done, "status", 130)
  assert.equal((await runStatusPass(s.container, at(31))).pruned, 0, "once a day")
  assert.equal((await runStatusPass(s.container, at(24 * 60 + 1))).pruned, 1)
})

test("refresh asks every live waybill, also a done one", async () => {
  const s = live(
    new Map([
      [
        wb(1),
        [
          { code: "040101", at: "2026-11-03 10:00:00" },
          { code: "190101", at: "2026-11-03 11:00:00" },
        ],
      ],
      [wb2(1), [{ code: "040101", at: "2026-11-03 10:30:00" }]],
    ]),
  )
  const row = handedTwo(s, 1)
  await runStatusPass(s.container, T0)
  assert.equal(stored(s, row.id).stage, "in_transit", "delivered only when every waybill is")
  const before = s.infoCalls.length
  await runStatusPass(s.container, at(31))
  assert.deepEqual(asked(s, before), [wb2(1)], "the pass skips the done waybill")
  const refreshed = s.infoCalls.length
  const out = await refreshShipmentStatus(s.container, String(row.id), { actor: ADMIN, now: at(40) })
  assert.deepEqual(asked(s, refreshed).sort(), [wb(1), wb2(1)].sort(), "O33")
  assert.equal(ms(out.last_checked_at), at(40).getTime())
  const history = s.events.rows.filter((e) => (e.data as Row | null)?.action === "status_refresh")
  assert.equal(history.length, 1)
  assert.equal(history[0].actor, ADMIN)
  assert.deepEqual({ ...(history[0].data as Row) }, { action: "status_refresh", asked: 2, answered: 2, newEvents: 0, outcome: "ok" })
})

test("demo: simulated events, demo true events, seed rows never move", async () => {
  const orders = Array.from({ length: 4 }, (_, i) => order({ id: `order_DEMO${String(i).padStart(4, "0")}`, display_id: 3000 + i, created_at: new Date(Date.UTC(2026, 9, 1, 8, i)) }))
  const s = setup({ demo: true }, orders)
  assert.ok((await ensureDemoSeed(s.container)) > 0)
  const seeds = s.shipments.rows.map((r) => ({ ...r }))
  const made = handed(s, 1, { handed_over_at: at(-7 * 60) } as Partial<ShipmentRow>)
  const r = await runStatusPass(s.container, T0)
  assert.equal(r.source, "simulated")
  assert.equal(r.picked, 1, "only the demo shipment with a fulfillment")
  assert.notEqual(stored(s, made.id).stage, "ready")
  assert.notEqual(stored(s, made.id).status, null)
  const events = statusEvents(s)
  assert.ok(events.length > 0)
  assert.ok(events.every((e) => e.mode === "demo" && e.source === "simulated" && (e.data as Row).simulated === true))
  const changed = s.emitted.find((e) => e.name === "dpd.shipment.status_changed")
  assert.equal(changed?.data.demo, true)
  assert.equal(changed?.data.mode, "demo")
  for (const seed of seeds) {
    const now = stored(s, seed.id)
    assert.equal(now.stage, seed.stage, String(seed.id))
    assert.equal(now.status, null)
    assert.equal(now.last_checked_at ?? null, null)
  }
  assert.deepEqual(flows(s), [])
})

/* ------------------------------------------------------------------ */
/* The writer backlog (6.19)                                           */
/* ------------------------------------------------------------------ */

const DELIVERED: Ev[] = [
  { code: "040101", at: "2026-11-03 10:00:00" },
  { code: "190101", at: "2026-11-03 11:00:00" },
]

test("a delivered row with an unwritten mark is a writer backlog row: the writer runs without a DPD call and outside the call limit", async () => {
  const s = live(new Map([[wb(1), DELIVERED]]))
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  assert.equal(stored(s, row.id).stage, "delivered")
  assert.deepEqual(flows(s), [], "not armed yet")
  arm(s, "fulfillmentStatus")
  const calls = s.infoCalls.length
  const r = await runStatusPass(s.container, at(31))
  assert.equal(r.picked, 1)
  assert.equal(r.backlog, 1)
  assert.equal(r.asked, 0)
  assert.equal(s.infoCalls.length, calls, "no DPD call for a backlog row")
  assert.deepEqual(flows(s), ["createOrderShipmentWorkflow", "markOrderFulfillmentAsDeliveredWorkflow"])
  assert.ok(stored(s, row.id).shipped_marked_at)
  assert.ok(stored(s, row.id).delivered_marked_at)
  assert.deepEqual(actionsOf(s, row.id).filter((a) => a.startsWith("writer_")), ["writer_shipped", "writer_delivered"])
})

test("a writer armed later marks the delivered rows of the last 30 days and not older ones", async () => {
  const s = live(
    new Map([
      [
        wb(1),
        [
          { code: "040101", at: "2026-10-07 10:00:00" },
          { code: "190101", at: "2026-10-08 10:00:00" },
        ],
      ],
      [
        wb(2),
        [
          { code: "040101", at: "2026-10-09 10:00:00" },
          { code: "190101", at: "2026-10-10 10:00:00" },
        ],
      ],
    ]),
  )
  const older = handed(s, 1, { created_at: new Date(T0.getTime() - 28 * DAY - MIN), handed_over_at: new Date(T0.getTime() - 28 * DAY) } as Partial<ShipmentRow>)
  const newer = handed(s, 2, { created_at: new Date(T0.getTime() - 26 * DAY - MIN), handed_over_at: new Date(T0.getTime() - 26 * DAY) } as Partial<ShipmentRow>)
  await runStatusPass(s.container, T0)
  assert.equal(stored(s, older.id).stage, "delivered")
  assert.equal(stored(s, newer.id).stage, "delivered")
  arm(s, "fulfillmentStatus")
  /* Three days later: the older row is 31 days old, the newer 29. */
  const r = await runStatusPass(s.container, new Date(T0.getTime() + 3 * DAY))
  assert.equal(r.backlog, 1)
  assert.deepEqual(
    s.coreFlows.calls.map((c) => (c.flow === "createOrderShipmentWorkflow" ? c.input.fulfillment_id : c.input.fulfillmentId)),
    [newer.fulfillment_id, newer.fulfillment_id],
  )
  assert.equal(stored(s, older.id).shipped_marked_at ?? null, null)
})

test("a returned row no longer asked, with possession and no shipped mark, is marked shipped as a backlog row without a DPD call", async () => {
  const dpd: Dpd = new Map([
    [
      wb(1),
      [
        { code: "040101", at: "2026-11-03 10:00:00" },
        { code: "230403", at: "2026-11-03 11:00:00", data: [{ code: "01", value: NEW_WAYBILL }] },
      ],
    ],
  ])
  const s = live(dpd)
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  assert.equal(stored(s, row.id).stage, "returned")
  dpd.set(NEW_WAYBILL, [{ code: "190101", at: "2026-11-03 13:20:00" }])
  await runStatusPass(s.container, at(31))
  assert.equal(stored(s, row.id).stage, "returned", "returned stays")
  arm(s, "fulfillmentStatus")
  const calls = s.infoCalls.length
  const r = await runStatusPass(s.container, at(62))
  assert.equal(r.backlog, 1)
  assert.equal(r.asked, 0)
  assert.equal(s.infoCalls.length, calls)
  assert.deepEqual(flows(s), ["createOrderShipmentWorkflow"], "shipped once, never delivered")
  assert.ok(stored(s, row.id).shipped_marked_at)
  assert.equal(stored(s, row.id).delivered_marked_at ?? null, null)
})

test("a return back at the shop leaves the problems group and the attention count; on its way back it waits for a person (E61)", async () => {
  const dpd: Dpd = new Map([
    [
      wb(1),
      [
        { code: "040101", at: "2026-11-03 10:00:00" },
        { code: "230403", at: "2026-11-03 11:00:00", data: [{ code: "01", value: NEW_WAYBILL }] },
      ],
    ],
  ])
  const s = live(dpd)
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  assert.equal(stored(s, row.id).stage, "returned")
  assert.equal(rowGroup(stored(s, row.id) as ShipmentRow, at(1)), "problems", "on its way back")
  /* Past the 30 days of 6.5 the plugin no longer follows it: over as well. */
  assert.equal(rowGroup(stored(s, row.id) as ShipmentRow, new Date(T0.getTime() + 31 * DAY)), "returns")
  dpd.set(NEW_WAYBILL, [{ code: "190101", at: "2026-11-03 13:20:00" }])
  await runStatusPass(s.container, at(31))
  const back = stored(s, row.id) as ShipmentRow
  assert.equal(back.stage, "returned", "returned stays")
  assert.equal(rowGroup(back, at(32)), "returns")
  const counts = countsOf(await s.store.counts("live"))
  assert.deepEqual([counts.problems, counts.returns, counts.attention], [0, 1, 0])
  const list = await s.store.list({ mode: "live", filter: "returns", q: null, offset: 0, limit: 10 })
  assert.deepEqual(list.rows.map((x) => x.id), [row.id])
})

test("a stale shipped mark without shipped_at in Medusa is released as writer_interrupted and written again", async () => {
  const s = live(new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]]))
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  /* A write that claimed its mark at T0+15 and never finished (the process ended). */
  Object.assign(stored(s, row.id), { shipped_marked_at: at(15), status_writer_error: null })
  arm(s, "fulfillmentStatus")
  const r = await runStatusPass(s.container, at(31))
  assert.equal(r.interrupted, 1)
  const writer = actionsOf(s, row.id).filter((a) => a.startsWith("writer_"))
  assert.deepEqual(writer, ["writer_interrupted", "writer_shipped"])
  assert.deepEqual(flows(s), ["createOrderShipmentWorkflow"])
  assert.equal(stored(s, row.id).status_writer_error, null)
  assert.equal(ms(stored(s, row.id).shipped_marked_at), at(31).getTime())
})

test("a stale mark with shipped_at in Medusa is checked once and never picked again", async () => {
  const s = live(new Map([[wb(1), DELIVERED]]))
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  Object.assign(stored(s, row.id), { shipped_marked_at: at(15), delivered_marked_at: at(15) })
  const f = s.fulfillments.get(String(row.fulfillment_id))
  assert.ok(f)
  Object.assign(f, { shipped_at: at(15), delivered_at: at(15) })
  arm(s, "fulfillmentStatus")
  const r = await runStatusPass(s.container, at(31))
  assert.equal(r.picked, 1)
  assert.equal(r.interrupted, 0)
  assert.deepEqual(flows(s), [])
  assert.equal((await runStatusPass(s.container, at(62))).picked, 0)
  assert.equal((await runStatusPass(s.container, at(120))).picked, 0)
  assert.ok(!actionsOf(s, row.id).includes("writer_interrupted"))
})

test("a mark younger than 15 minutes is left alone", async () => {
  const s = live(new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]]))
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  Object.assign(stored(s, row.id), { shipped_marked_at: at(25) })
  arm(s, "fulfillmentStatus")
  const r = await runStatusPass(s.container, at(31))
  assert.equal(r.interrupted, 0)
  assert.ok(!actionsOf(s, row.id).includes("writer_interrupted"))
  assert.deepEqual(flows(s), [])
  assert.equal(ms(stored(s, row.id).shipped_marked_at), at(25).getTime())
})

test("a read failure of the fulfillment gives the backlog row its claim back without a writer call", async () => {
  const s = live(new Map([[wb(1), DELIVERED]]))
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  Object.assign(stored(s, row.id), { shipped_marked_at: at(15) })
  arm(s, "fulfillmentStatus")
  s.fulfillmentFaults.list = true
  const r = await runStatusPass(s.container, at(31))
  assert.equal(r.picked, 1)
  assert.equal(r.backlog, 1)
  assert.deepEqual(flows(s), [])
  assert.equal(ms(stored(s, row.id).last_checked_at), T0.getTime(), "the claim given back (prev_checked_at)")
  assert.equal(ms(stored(s, row.id).shipped_marked_at), at(15).getTime())
})

test("backlog rows never push status rows out of the claim", async () => {
  const s = live(new Map())
  const status = Array.from({ length: STATUS_BATCH_WAYBILLS }, (_, i) => handed(s, i + 1))
  const backlog = Array.from({ length: 3 }, (_, i) => handed(s, 100 + i, { stage: "delivered", shipped_marked_at: new Date(T0.getTime() - DAY) } as Partial<ShipmentRow>))
  for (const b of backlog) {
    const f = s.fulfillments.get(String(b.fulfillment_id))
    assert.ok(f)
    f.shipped_at = new Date(T0.getTime() - DAY)
  }
  arm(s, "fulfillmentStatus")
  const r = await runStatusPass(s.container, T0)
  assert.equal(r.picked, STATUS_BATCH_WAYBILLS + 3, "separate limits for the two parts")
  assert.equal(r.asked, STATUS_BATCH_WAYBILLS)
  assert.equal(r.backlog, 3)
  for (const row of status) assert.equal(ms(stored(s, row.id).last_checked_at), T0.getTime())
  assert.deepEqual(flows(s), Array(3).fill("markOrderFulfillmentAsDeliveredWorkflow"))
})

/** Delivered rows already shipped in Medusa: backlog rows that only want delivered. */
function backlogRows(s: Setup, from: number, n: number): Row[] {
  const rows = Array.from({ length: n }, (_, i) => handed(s, from + i, { stage: "delivered", shipped_marked_at: new Date(T0.getTime() - DAY) } as Partial<ShipmentRow>))
  for (const b of rows) {
    const f = s.fulfillments.get(String(b.fulfillment_id))
    assert.ok(f)
    f.shipped_at = new Date(T0.getTime() - DAY)
  }
  return rows
}

/** A pass over 20 due status rows and MIN_ROWS + 2 backlog rows where every InfoServices call takes `callMs` (a slow host, or a low requestsPerMinute). */
async function slowPass(callMs: number) {
  const realNow = Date.now.bind(Date)
  let skew = 0
  mock.method(Date, "now", () => realNow() + skew)
  try {
    const s = setup(LIVE, [], {
      info: () => {
        skew += callMs
        return { body: eventsXml([]) }
      },
    })
    for (let i = 1; i <= 20; i += 1) handed(s, i)
    const backlog = backlogRows(s, 100, STATUS_WRITER_MIN_ROWS + 2)
    arm(s, "fulfillmentStatus")
    const r = await runStatusPass(s.container, T0)
    return { s, r, backlog, skew }
  } finally {
    mock.restoreAll()
  }
}

test("slow DPD calls never starve the writer backlog: the status rows stop early and the first backlog rows run past the budget", async () => {
  /* 25 s a call: the status rows stop at the budget less the writer reserve, and the whole backlog runs. */
  const reserve = await slowPass(25_000)
  assert.equal(reserve.r.stoppedBy, "budget")
  assert.equal(reserve.r.asked, (STATUS_PASS_BUDGET_MS - STATUS_WRITER_RESERVE_MS) / 25_000, "calls start at 0, 25, 50 and 75 s")
  assert.equal(reserve.r.backlog, STATUS_WRITER_MIN_ROWS + 2)
  assert.deepEqual(flows(reserve.s), Array(STATUS_WRITER_MIN_ROWS + 2).fill("markOrderFulfillmentAsDeliveredWorkflow"))

  /* 60 s a call: the budget is gone before the backlog; its first rows still run, the rest gets its claim back. */
  const slow = await slowPass(60_000)
  assert.equal(slow.r.stoppedBy, "budget")
  assert.equal(slow.r.asked, 2)
  assert.ok(slow.skew >= STATUS_PASS_BUDGET_MS, "the pass budget is used up before the backlog")
  assert.equal(slow.r.backlog, STATUS_WRITER_MIN_ROWS)
  assert.deepEqual(flows(slow.s), Array(STATUS_WRITER_MIN_ROWS).fill("markOrderFulfillmentAsDeliveredWorkflow"))
  const waiting = slow.backlog.filter((b) => !stored(slow.s, b.id).delivered_marked_at)
  assert.equal(waiting.length, 2)
  for (const b of waiting) assert.equal(stored(slow.s, b.id).last_checked_at ?? null, null, "first in the next pass")
})

test("a stale mark claimed again since the row was read is never released", async () => {
  const s = live(new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]]))
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  arm(s, "fulfillmentStatus")
  /* The pass read the row with a mark left 20 minutes ago by a stopped process. */
  const snapshot = { ...stored(s, row.id), shipped_marked_at: at(11) } as ShipmentRow
  /* Meanwhile a retry released it and claimed it again; its workflow still runs, so Medusa has no shipped_at yet. */
  Object.assign(stored(s, row.id), { shipped_marked_at: at(30), status_writer_error: null })
  const rel = await releaseStaleMarks(s.container, snapshot, { actor: "system", now: at(31), checkedBefore: T0, anyError: false })
  assert.deepEqual(rel, { released: [], readFailed: false })
  assert.equal(ms(stored(s, row.id).shipped_marked_at), at(30).getTime(), "the fresh claim stays")
  assert.equal(stored(s, row.id).status_writer_error, null)
  assert.ok(!actionsOf(s, row.id).includes("writer_interrupted"))
  /* The mark it read is released as before. */
  Object.assign(stored(s, row.id), { shipped_marked_at: at(11) })
  assert.deepEqual((await releaseStaleMarks(s.container, snapshot, { actor: "system", now: at(31), checkedBefore: T0, anyError: false })).released, ["shipped_marked_at"])
  assert.equal(stored(s, row.id).shipped_marked_at, null)
})

test("a refresh releases a stale mark before it writes last_checked_at, so the write to Medusa is never lost", async () => {
  const s = live(new Map([[wb(1), DELIVERED]]))
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  assert.equal(stored(s, row.id).stage, "delivered")
  /* The pass at T0 marked shipped and claimed delivered, then the process ended before the delivered workflow. */
  Object.assign(stored(s, row.id), { shipped_marked_at: T0, delivered_marked_at: T0, status_writer_error: null })
  const f = s.fulfillments.get(String(row.fulfillment_id))
  assert.ok(f)
  f.shipped_at = T0
  arm(s, "fulfillmentStatus")
  /* A person refreshes 20 minutes later, while Medusa still shows the order not delivered. */
  const out = await refreshShipmentStatus(s.container, String(row.id), { actor: ADMIN, now: at(20) })
  assert.deepEqual(actionsOf(s, row.id).filter((a) => a.startsWith("writer_")), ["writer_interrupted", "writer_delivered"])
  assert.deepEqual(flows(s), ["markOrderFulfillmentAsDeliveredWorkflow"])
  assert.ok(f.delivered_at)
  assert.equal(ms(out.delivered_marked_at), at(20).getTime())
  assert.equal(out.status_writer_error, null)
  assert.equal(ms(out.last_checked_at), at(20).getTime())
  /* The fresh mark gets its one check, finds delivered_at in Medusa, and the row is never picked again. */
  const check = await runStatusPass(s.container, at(51))
  assert.equal(check.interrupted, 0)
  assert.deepEqual(flows(s), ["markOrderFulfillmentAsDeliveredWorkflow"])
  assert.equal((await runStatusPass(s.container, at(82))).picked, 0)
})

test("a refresh leaves a young mark alone and the pass still releases it once it is stale", async () => {
  const s = live(new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]]))
  const row = handed(s, 1)
  await runStatusPass(s.container, T0)
  Object.assign(stored(s, row.id), { shipped_marked_at: T0, status_writer_error: null })
  arm(s, "fulfillmentStatus")
  await refreshShipmentStatus(s.container, String(row.id), { actor: ADMIN, now: at(10) })
  assert.ok(!actionsOf(s, row.id).includes("writer_interrupted"), "younger than 15 minutes")
  assert.equal(ms(stored(s, row.id).shipped_marked_at), T0.getTime())
  const r = await runStatusPass(s.container, at(41))
  assert.equal(r.interrupted, 1)
  assert.deepEqual(flows(s), ["createOrderShipmentWorkflow"])
})

/** A stale shipped mark left on an in_transit row at T0+15 by a stopped process, with the writer disarmed. */
async function staleMarkDisarmed(): Promise<{ s: Setup; row: Row }> {
  const s = live(new Map([[wb(1), [{ code: "040101", at: "2026-11-03 11:00:00" }]]]))
  const row = handed(s, 1)
  arm(s, "fulfillmentStatus", false)
  await runStatusPass(s.container, T0)
  Object.assign(stored(s, row.id), { shipped_marked_at: at(15), status_writer_error: null })
  return { s, row }
}

/** The stale mark is gone with writer_interrupted; once armed, the next pass marks the fulfillment shipped. */
async function writtenOnceArmed(s: Setup, row: Row, next: Date): Promise<void> {
  assert.equal(stored(s, row.id).shipped_marked_at, null)
  assert.equal(stored(s, row.id).status_writer_error, WRITER_INTERRUPTED_MESSAGE, "the counter, the filter and the retry see it")
  assert.ok(actionsOf(s, row.id).includes("writer_interrupted"))
  assert.deepEqual(flows(s), [], "nothing written while disarmed")
  arm(s, "fulfillmentStatus")
  await runStatusPass(s.container, next)
  assert.deepEqual(flows(s), ["createOrderShipmentWorkflow"])
  assert.equal(stored(s, row.id).status_writer_error, null)
  assert.equal(ms(stored(s, row.id).shipped_marked_at), next.getTime())
}

test("a pass with the writer disarmed or unreadable still releases a stale mark, so its one check is never used up", async () => {
  const disarmed = await staleMarkDisarmed()
  const r = await runStatusPass(disarmed.s.container, at(31))
  assert.equal(r.interrupted, 1)
  assert.equal(r.asked, 1, "the row is still asked")
  await writtenOnceArmed(disarmed.s, disarmed.row, at(62))

  /* The writers cannot be read (writerBacklog false): the same. */
  const unreadable = await staleMarkDisarmed()
  arm(unreadable.s, "fulfillmentStatus")
  const table = unreadable.s.settings
  const list = table.list.bind(table)
  mock.method(table, "list", (filter: Row = {}, config: Parameters<typeof list>[1] = {}) => {
    if (Array.isArray(filter.key)) throw new Error("settings down")
    return list(filter, config)
  })
  try {
    assert.equal((await runStatusPass(unreadable.s.container, at(31))).interrupted, 1)
  } finally {
    mock.restoreAll()
  }
  arm(unreadable.s, "fulfillmentStatus", false)
  await writtenOnceArmed(unreadable.s, unreadable.row, at(62))
})

test("a refresh with the writer disarmed still releases a stale mark before it writes last_checked_at", async () => {
  const { s, row } = await staleMarkDisarmed()
  const out = await refreshShipmentStatus(s.container, String(row.id), { actor: ADMIN, now: at(31) })
  assert.equal(ms(out.last_checked_at), at(31).getTime())
  await writtenOnceArmed(s, row, at(62))
})

test("a returned row no longer asked releases a stale mark with the writer disarmed, and the backlog writes it once armed", async () => {
  const dpd: Dpd = new Map([
    [
      wb(1),
      [
        { code: "040101", at: "2026-11-03 10:00:00" },
        { code: "230403", at: "2026-11-03 11:00:00", data: [{ code: "01", value: NEW_WAYBILL }] },
      ],
    ],
  ])
  const s = live(dpd)
  const row = handed(s, 1)
  arm(s, "fulfillmentStatus", false)
  await runStatusPass(s.container, T0)
  dpd.set(NEW_WAYBILL, [{ code: "190101", at: "2026-11-03 13:20:00" }])
  await runStatusPass(s.container, at(31))
  assert.equal(stored(s, row.id).stage, "returned")
  Object.assign(stored(s, row.id), { shipped_marked_at: at(40), status_writer_error: null })
  const calls = s.infoCalls.length
  const r = await runStatusPass(s.container, at(62))
  assert.equal(r.interrupted, 1)
  assert.equal(r.backlog, 0, "no backlog while disarmed")
  assert.equal(s.infoCalls.length, calls, "no DPD call")
  await writtenOnceArmed(s, row, at(93))
})
