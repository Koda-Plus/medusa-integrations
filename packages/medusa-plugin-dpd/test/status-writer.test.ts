/**
 * The writer fulfillmentStatus of stage 5 (6.4, 6.11, flow): shipped from
 * possession, the whole label list, the items, delivered after shipped in
 * Medusa, failures and their release, the race of a refresh against a
 * running shipment workflow, the pending note, demo and the sandbox. The
 * Medusa core flows are fakeCoreFlows over the fake fulfillments; no network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { STATUS_MAX_AGE_DAYS } from "../src/modules/dpd/lib/constants.ts"
import type { ShipmentRow } from "../src/modules/dpd/lib/dto.ts"
import { GET as getShipments } from "../src/api/admin/dpd/shipments/route.ts"
import type { ShipmentsResponse } from "../src/modules/dpd/lib/contract.ts"
import { foldItems, labelsFor, retryStatusWriter, runStatusPass, runStatusWriter, writerRetryResult, type WriterRun } from "../src/workflows/dpd/statuses.ts"
import { eventsXml } from "./fake-infoservices.ts"
import { arm, cancelFulfillment, insertLabeled, labeledOrder, LIVE_INFO, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

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
  assert.equal(requests, 0, "the writer calls only the fake core flows")
})

const ADMIN = "user_01ADMIN"
const MIN = 60_000
const DAY = 86_400_000
const T0 = new Date("2026-11-03T12:00:00.000Z")
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN)
const LIVE = { ...LIVE_INFO, fulfillmentStatusWriter: true }
const RETURN_WAYBILL = "9000000000001R"

const wb = (i: number) => `0000${String(i).padStart(4, "0")}0000U`
const wb2 = (i: number) => `1111${String(i).padStart(4, "0")}1111U`

/** A tracking entry (6.2) at T0 minus an hour. */
function entry(waybill: string, over: Row = {}): Row {
  const when = at(-60).toISOString()
  return { waybill, box: 0, role: "outbound", stage: "in_transit", code: "040101", at: when, possession: true, lastCode: "040101", lastAt: when, description: null, supersededBy: null, supersededAt: null, from: null, checkedAt: when, done: false, ...over }
}
const delivered = (waybill: string, over: Row = {}) => entry(waybill, { stage: "delivered", code: "190101", lastCode: "190101", done: true, ...over })

/** A labeled row handed over before T0 with the given stage and tracking; returns the stored row. */
function row(s: Setup, i: number, over: Partial<ShipmentRow> & { tracking?: unknown } = {}): ShipmentRow {
  const inserted = insertLabeled(s, labeledOrder(i), { created_at: new Date(T0.getTime() - DAY), handed_over_at: at(-120), stage: "in_transit", tracking: [entry(wb(i))], ...over } as Partial<ShipmentRow>)
  return fresh(s, inserted.id)
}

function stored(s: Setup, id: unknown): Row {
  const r = s.shipments.rows.find((x) => x.id === id)
  assert.ok(r)
  return r
}
const fresh = (s: Setup, id: unknown) => ({ ...stored(s, id) }) as unknown as ShipmentRow
const flows = (s: Setup) => s.coreFlows.calls.map((c) => c.flow)
const actionsOf = (s: Setup, id: unknown) => s.events.rows.filter((e) => e.shipment_id === id && e.kind === "action").map((e) => String((e.data as Row | null)?.action ?? ""))
const fulfillment = (s: Setup, r: { fulfillment_id: string | null }) => {
  const f = s.fulfillments.get(String(r.fulfillment_id))
  assert.ok(f)
  return f
}

async function write(s: Setup, r: ShipmentRow, now = T0) {
  return runStatusWriter(s.container, r, { actor: "system", now })
}

function armed(options = LIVE): Setup {
  const s = setup(options)
  arm(s, "fulfillmentStatus")
  return s
}

test("shipped only from possession, never from the handover alone", async () => {
  const s = armed()
  const ready = row(s, 1, { stage: "ready", tracking: null } as Partial<ShipmentRow>)
  assert.equal((await write(s, ready)).skipped, "nothing_wanted")
  const failedPickup = row(s, 2, { stage: "problem", tracking: [entry(wb(2), { stage: "problem", code: "040201", lastCode: "040201", possession: false })] } as Partial<ShipmentRow>)
  assert.equal((await write(s, failedPickup)).skipped, "nothing_wanted", "040201 is no possession (E25)")
  assert.deepEqual(flows(s), [])

  const picked = row(s, 3)
  const run = await write(s, picked)
  assert.equal(run.shipped, "marked")
  assert.equal(run.delivered, null)
  assert.deepEqual(flows(s), ["createOrderShipmentWorkflow"])
  assert.equal(ms(stored(s, picked.id).shipped_marked_at), T0.getTime())
  assert.ok(fulfillment(s, picked).shipped_at)
  assert.deepEqual(actionsOf(s, picked.id), ["writer_shipped"])
})

test("the labels sent are the whole list: existing ones with their id plus the waybills", async () => {
  const s = armed()
  const r = row(s, 1, { waybills: [wb(1), wb2(1)], tracking: [entry(wb(1)), entry(wb2(1), { box: 1 })] } as Partial<ShipmentRow>)
  fulfillment(s, r).labels = [
    { id: "flab_old", tracking_number: "OTHER-CARRIER-1", tracking_url: "https://example.com/t", label_url: "https://example.com/l" },
    { id: "flab_first", tracking_number: wb(1), tracking_url: "", label_url: "" },
  ]
  await write(s, r)
  const [call] = s.coreFlows.calls
  assert.equal(call.flow, "createOrderShipmentWorkflow")
  assert.deepEqual(call.flow === "createOrderShipmentWorkflow" ? call.input.labels : null, [
    { id: "flab_old", tracking_number: "OTHER-CARRIER-1", tracking_url: "https://example.com/t", label_url: "https://example.com/l" },
    { id: "flab_first", tracking_number: wb(1), tracking_url: "", label_url: "" },
    { tracking_number: wb2(1), tracking_url: "", label_url: "" },
  ])
  assert.deepEqual(
    fulfillment(s, r).labels?.map((l) => l.tracking_number),
    ["OTHER-CARRIER-1", wb(1), wb2(1)],
    "H14: nothing the fulfillment had is lost",
  )
  assert.deepEqual(labelsFor([], [wb(1), wb(1)]), [{ tracking_number: wb(1), tracking_url: "", label_url: "" }])
})

test("items are folded by line_item_id", async () => {
  const s = armed()
  const r = row(s, 1)
  fulfillment(s, r).items = [
    { line_item_id: "li_1", quantity: 1 },
    { line_item_id: "li_2", quantity: 3 },
    { line_item_id: "li_1", quantity: 2 },
  ]
  await write(s, r)
  const [call] = s.coreFlows.calls
  assert.deepEqual(call.flow === "createOrderShipmentWorkflow" ? call.input.items : null, [
    { id: "li_1", quantity: 3 },
    { id: "li_2", quantity: 3 },
  ])
  assert.deepEqual(foldItems([{ line_item_id: "a", quantity: "2" }, { line_item_id: "a", quantity: { numeric: 4 } }, { line_item_id: "b", quantity: null }]), [
    { id: "a", quantity: 6 },
    { id: "b", quantity: 0 },
  ])
})

test("delivered waits for shipped and for every waybill delivered", async () => {
  const s = armed()
  const r = row(s, 1, { waybills: [wb(1), wb2(1)], stage: "in_transit", tracking: [delivered(wb(1)), entry(wb2(1), { box: 1 })] } as Partial<ShipmentRow>)
  const first = await write(s, r)
  assert.equal(first.shipped, "marked")
  assert.equal(first.delivered, null, "one waybill is still on its way")
  Object.assign(stored(s, r.id), { stage: "delivered", tracking: [delivered(wb(1)), delivered(wb2(1), { box: 1 })] })
  const second = await write(s, fresh(s, r.id))
  assert.equal(second.shipped, null)
  assert.equal(second.delivered, "marked")
  assert.deepEqual(flows(s), ["createOrderShipmentWorkflow", "markOrderFulfillmentAsDeliveredWorkflow"])
  assert.deepEqual(actionsOf(s, r.id), ["writer_shipped", "writer_delivered"])
})

test("a return waybill delivered never marks delivered", async () => {
  const s = armed()
  const r = row(s, 1, {
    waybills: [RETURN_WAYBILL],
    stage: "returned",
    tracking: [
      entry(RETURN_WAYBILL, { role: "return", stage: "delivered", code: "190101", lastCode: "190101", from: wb(1), done: true }),
      entry(wb(1), { stage: "returned", code: "230403", lastCode: "230403", supersededBy: RETURN_WAYBILL, supersededAt: at(-30).toISOString(), done: true }),
    ],
  } as Partial<ShipmentRow>)
  const run = await write(s, r)
  assert.equal(run.shipped, "marked")
  assert.equal(run.delivered, null)
  assert.deepEqual(flows(s), ["createOrderShipmentWorkflow"])
})

test("already shipped in Medusa: writer_already_shipped, the claim stays", async () => {
  const s = armed()
  const r = row(s, 1)
  fulfillment(s, r).shipped_at = at(-30)
  const run = await write(s, r)
  assert.equal(run.shipped, "already")
  assert.deepEqual(flows(s), [])
  assert.equal(ms(stored(s, r.id).shipped_marked_at), T0.getTime())
  assert.deepEqual(actionsOf(s, r.id), ["writer_already_shipped"])
})

test("a failing workflow releases the claim and stores the error; a later pass tries again within 30 days while the writer is armed", async () => {
  const answers = new Map<string, string>([
    [wb(1), eventsXml([{ waybill: wb(1), code: "040101", eventTimeRaw: "2026-11-03 11:00:00", description: "Odebrana" }])],
    [
      wb(2),
      eventsXml([
        { waybill: wb(2), code: "040101", eventTimeRaw: "2026-11-03 10:00:00", description: "Odebrana" },
        { waybill: wb(2), code: "190101", eventTimeRaw: "2026-11-03 11:00:00", description: "Doręczona" },
      ]),
    ],
  ])
  const s = setup(LIVE, [], { info: (req) => ({ body: answers.get(req.waybill ?? "") ?? eventsXml([]) }) })
  arm(s, "fulfillmentStatus")
  const moving = insertLabeled(s, labeledOrder(1), { created_at: new Date(T0.getTime() - DAY), handed_over_at: at(-120), stage: "ready" } as Partial<ShipmentRow>)
  const done = insertLabeled(s, labeledOrder(2), { created_at: new Date(T0.getTime() - DAY), handed_over_at: at(-120), stage: "ready" } as Partial<ShipmentRow>)
  s.coreFlows.fail.createOrderShipmentWorkflow = new Error("Medusa refused the shipment")
  await runStatusPass(s.container, T0)
  for (const r of [moving, done]) {
    assert.equal(stored(s, r.id).shipped_marked_at, null, "the claim is released")
    assert.equal(stored(s, r.id).status_writer_error, "Medusa refused the shipment")
    assert.ok(actionsOf(s, r.id).includes("writer_failed"))
  }
  assert.equal(stored(s, done.id).stage, "delivered")

  s.coreFlows.fail.createOrderShipmentWorkflow = null
  await runStatusPass(s.container, at(31))
  assert.ok(stored(s, moving.id).shipped_marked_at, "the status part writes again")
  assert.ok(stored(s, done.id).delivered_marked_at, "the backlog part writes the delivered row")
  assert.equal(stored(s, moving.id).status_writer_error, null)
  assert.equal(stored(s, done.id).status_writer_error, null)

  /* Disarmed or past STATUS_MAX_AGE_DAYS: only a person retries. */
  const later = insertLabeled(s, labeledOrder(3), { created_at: new Date(T0.getTime() - DAY), handed_over_at: at(-120), stage: "delivered", tracking: [delivered(wb(3))] } as Partial<ShipmentRow>)
  const old = insertLabeled(s, labeledOrder(4), { created_at: new Date(T0.getTime() - (STATUS_MAX_AGE_DAYS + 1) * DAY), handed_over_at: new Date(T0.getTime() - (STATUS_MAX_AGE_DAYS + 1) * DAY), stage: "delivered", tracking: [delivered(wb(4))] } as Partial<ShipmentRow>)
  arm(s, "fulfillmentStatus", false)
  const disarmed = await runStatusPass(s.container, at(62))
  assert.equal(disarmed.backlog, 0, "no writer backlog while disarmed")
  assert.equal(stored(s, later.id).shipped_marked_at ?? null, null)
  arm(s, "fulfillmentStatus")
  const calls = s.coreFlows.calls.length
  await runStatusPass(s.container, at(93))
  assert.ok(stored(s, later.id).delivered_marked_at)
  assert.equal(stored(s, old.id).shipped_marked_at ?? null, null)
  assert.equal(s.coreFlows.calls.slice(calls).length, 2, "the recent row only")
})

test("delivered waits for shipped_at in Medusa, not for a shipped claim alone", async () => {
  const s = armed()
  const r = row(s, 1, { stage: "delivered", shipped_marked_at: at(-5), tracking: [delivered(wb(1))] } as Partial<ShipmentRow>)
  const run = await write(s, r)
  assert.equal(run.delivered, null)
  assert.deepEqual(flows(s), [])
  assert.equal(stored(s, r.id).delivered_marked_at ?? null, null)
})

test("a core flows import failure after the claim releases it and stores the error", async () => {
  const s = armed()
  const r = row(s, 1)
  /* The registered core flows fail the way a missing @medusajs/medusa/core-flows would: inside the try of the won claim. */
  const failing = {
    get createOrderShipmentWorkflow(): never {
      throw new Error("Cannot find module '@medusajs/medusa/core-flows'")
    },
    get markOrderFulfillmentAsDeliveredWorkflow(): never {
      throw new Error("Cannot find module '@medusajs/medusa/core-flows'")
    },
  }
  const resolve = s.container.resolve
  s.container.resolve = <T,>(key: string, opts?: { allowUnregistered?: boolean }): T => (key === "dpdCoreFlows" ? (failing as T) : resolve<T>(key, opts))
  const run = await write(s, r)
  assert.equal(run.shipped, "failed")
  assert.equal(stored(s, r.id).shipped_marked_at, null)
  assert.match(String(stored(s, r.id).status_writer_error), /Cannot find module/)
  assert.deepEqual(actionsOf(s, r.id), ["writer_failed"])
})

test("a refresh to delivered during the shipment workflow of another call ends delivered in Medusa", async () => {
  /* Side B: the refresh saw delivered while the shipped claim of side A had no shipped_at yet. */
  const b = armed()
  const rb = row(b, 1, { stage: "delivered", shipped_marked_at: T0, tracking: [delivered(wb(1))] } as Partial<ShipmentRow>)
  const runB = await write(b, rb)
  assert.equal(runB.delivered, null)
  assert.deepEqual(flows(b), [])
  assert.equal(stored(b, rb.id).delivered_marked_at ?? null, null)
  assert.match(String(stored(b, rb.id).status_writer_error), /^Not written to Medusa yet/)

  /* Side A: its shipment workflow runs while B writes delivered and its note. */
  const a = armed()
  const ra = row(a, 1)
  a.coreFlows.beforeRun = (call) => {
    if (call.flow !== "createOrderShipmentWorkflow") return
    Object.assign(stored(a, ra.id), {
      stage: "delivered",
      tracking: [delivered(wb(1))],
      status_writer_error: "Not written to Medusa yet: waiting for the shipped mark of another write. Write it again if it stays.",
    })
  }
  const runA = await write(a, ra)
  assert.equal(runA.shipped, "marked")
  assert.equal(runA.delivered, "marked", "A reads the row again after shipped (6.11 point 7.5)")
  assert.deepEqual(flows(a), ["createOrderShipmentWorkflow", "markOrderFulfillmentAsDeliveredWorkflow"])
  assert.equal(stored(a, ra.id).status_writer_error, null, "the claim of delivered clears the note")
  assert.ok(stored(a, ra.id).delivered_marked_at)
})

test("a read failure of the fulfillment on a row no longer due leaves a pending note that a retry can take", async () => {
  const s = armed()
  const r = row(s, 1, { stage: "delivered", tracking: [delivered(wb(1))] } as Partial<ShipmentRow>)
  s.fulfillmentFaults.list = true
  const run = await write(s, r)
  assert.equal(run.skipped, "read_failed")
  assert.match(String(stored(s, r.id).status_writer_error), /^Not written to Medusa yet/)
  assert.equal(stored(s, r.id).shipped_marked_at ?? null, null)
  const list = { status: 0, body: undefined as ShipmentsResponse | undefined }
  const res = {
    setHeader: () => res,
    status: (c: number) => ((list.status = c), res),
    json: (b: ShipmentsResponse) => ((list.body = b), res),
  }
  await getShipments({ scope: s.container, query: { writer: "failed" }, params: {}, body: {} } as never, res as never)
  assert.deepEqual(list.body?.shipments.map((x) => x.id), [r.id])

  s.fulfillmentFaults.list = false
  const retried = await retryStatusWriter(s.container, String(r.id), { actor: ADMIN, now: at(5) })
  assert.ok(retried.shipped_marked_at)
  assert.ok(retried.delivered_marked_at)
  assert.equal(retried.status_writer_error, null)
  assert.deepEqual(flows(s), ["createOrderShipmentWorkflow", "markOrderFulfillmentAsDeliveredWorkflow"])

  /* The same failure on a row still due writes nothing: the next pass tries again. */
  const due = row(s, 2)
  s.fulfillmentFaults.list = true
  assert.equal((await write(s, due)).skipped, "read_failed")
  assert.equal(stored(s, due.id).status_writer_error ?? null, null)
})

test("a workflow error with shipped_at set after it counts as shipped", async () => {
  const s = armed()
  const r = row(s, 1)
  s.coreFlows.beforeRun = (call) => {
    if (call.flow === "createOrderShipmentWorkflow") fulfillment(s, r).shipped_at = new Date()
  }
  s.coreFlows.fail.createOrderShipmentWorkflow = new Error("connection reset after the commit")
  const run = await write(s, r)
  assert.equal(run.shipped, "already")
  assert.equal(run.error, null)
  assert.ok(stored(s, r.id).shipped_marked_at)
  assert.equal(stored(s, r.id).status_writer_error ?? null, null)
  assert.deepEqual(actionsOf(s, r.id), ["writer_already_shipped"])
})

test("not armed: nothing, no history", async () => {
  const s = setup(LIVE)
  const r = row(s, 1, { stage: "delivered", tracking: [delivered(wb(1))] } as Partial<ShipmentRow>)
  assert.equal((await write(s, r)).skipped, "not_armed")
  assert.deepEqual(flows(s), [])
  assert.deepEqual(actionsOf(s, r.id), [])
  assert.equal(stored(s, r.id).shipped_marked_at ?? null, null)
})

test("demo: writer_demo_shipped without a workflow call", async () => {
  const s = armed({ demo: true })
  const r = row(s, 1, { stage: "delivered", tracking: [delivered(wb(1))] } as Partial<ShipmentRow>)
  const run = await write(s, r)
  assert.equal(run.shipped, "demo")
  assert.equal(run.delivered, "demo")
  assert.deepEqual(flows(s), [])
  assert.deepEqual(actionsOf(s, r.id), ["writer_demo_shipped", "writer_demo_delivered"])
  const history = s.events.rows.filter((e) => e.kind === "action")
  assert.ok(history.every((e) => (e.data as Row).simulated === true && e.mode === "demo"))
})

test("sandbox: real workflow calls with simulated true in the history", async () => {
  const s = armed({ ...SANDBOX, fulfillmentStatusWriter: true })
  const r = row(s, 1)
  assert.equal((await write(s, r)).shipped, "marked")
  assert.deepEqual(flows(s), ["createOrderShipmentWorkflow"])
  const [history] = s.events.rows.filter((e) => e.kind === "action")
  assert.equal((history.data as Row).action, "writer_shipped")
  assert.equal((history.data as Row).simulated, true)
  assert.match(String(history.message), /^Simulated status: /)
  const [call] = s.coreFlows.calls
  assert.equal(call.flow === "createOrderShipmentWorkflow" && call.input.no_notification, true, "a simulated status mails no customer")
})

test("a canceled or missing fulfillment: no claim, no call", async () => {
  const s = armed()
  const canceled = row(s, 1)
  cancelFulfillment(s, String(canceled.fulfillment_id))
  assert.equal((await write(s, canceled)).skipped, "fulfillment_canceled")
  const gone = row(s, 2)
  s.fulfillments.delete(String(gone.fulfillment_id))
  assert.equal((await write(s, gone)).skipped, "fulfillment_gone")
  assert.deepEqual(flows(s), [])
  for (const r of [canceled, gone]) {
    assert.equal(stored(s, r.id).shipped_marked_at ?? null, null)
    assert.deepEqual(actionsOf(s, r.id), [])
  }
})

function ms(v: unknown): number | null {
  return v instanceof Date ? v.getTime() : v === null || v === undefined ? null : new Date(String(v)).getTime()
}

test("writerRetryResult: written only when every step that ran reached Medusa (E56)", () => {
  const run = (over: Partial<WriterRun>): WriterRun => ({ skipped: null, shipped: null, delivered: null, error: null, ...over })
  assert.equal(writerRetryResult(run({ shipped: "marked" })), "written")
  assert.equal(writerRetryResult(run({ shipped: "already", delivered: "marked" })), "written")
  assert.equal(writerRetryResult(run({ shipped: "demo" })), "written")
  assert.equal(writerRetryResult(run({ shipped: "marked", delivered: "failed", error: "x" })), "failed")
  assert.equal(writerRetryResult(run({ shipped: "failed", error: "x" })), "failed")
  for (const skipped of ["not_outbound", "no_fulfillment", "stage_canceled", "nothing_wanted", "fulfillment_gone", "fulfillment_canceled"] as const) {
    assert.equal(writerRetryResult(run({ skipped })), "nothing_left", skipped)
  }
  assert.equal(writerRetryResult(run({ skipped: "read_failed" })), "not_written")
  assert.equal(writerRetryResult(run({ skipped: "not_armed" })), "not_written")
  assert.equal(writerRetryResult(run({ shipped: "lost_claim" })), "in_progress")
  assert.equal(writerRetryResult(run({ shipped: "marked", delivered: "lost_claim" })), "in_progress")
  /* Delivered waits for a shipped mark another process holds: nothing ran. */
  assert.equal(writerRetryResult(run({})), "in_progress")
  /* E62: a store error (claimMark or releaseMark threw) is no write of another process. */
  assert.equal(writerRetryResult(run({ error: "db timeout" })), "failed")
  assert.equal(writerRetryResult(run({ shipped: "marked", error: "db timeout" })), "failed", "delivered stopped after shipped")
})
