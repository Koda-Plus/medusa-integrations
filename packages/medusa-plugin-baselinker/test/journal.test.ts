import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { applyJournal, emptyJournal, journalHealth, journalPlan, parseJournal } from "../src/modules/baselinker/lib/journal.ts"
import { runStatusPass } from "../src/workflows/baselinker/journal.ts"
import { fakeContainer, fakeService, scriptedBaseLinker, silentEvents, type Row } from "./fakes.ts"

const HOUR = 3600 * 1000

test("plan: the full read runs until the journal proves it works, every two hours after, and after a stale cursor", () => {
  const now = 1_790_000_000_000
  assert.deepEqual(journalPlan(emptyJournal(), now, "off"), { read: false, full: true })
  assert.deepEqual(journalPlan(emptyJournal(), now, "auto"), { read: true, full: true }, "first read: cursor and a full pass")
  const quiet = { ...emptyJournal(), lastLogId: 10, lastReadAt: now - HOUR, lastFullAt: now - HOUR }
  assert.deepEqual(journalPlan(quiet, now, "auto"), { read: true, full: true }, "never an event yet: maybe not enabled")
  const working = { ...quiet, everEvents: true }
  assert.deepEqual(journalPlan(working, now, "auto"), { read: true, full: false })
  assert.deepEqual(journalPlan({ ...working, lastFullAt: now - 3 * HOUR }, now, "auto"), { read: true, full: true }, "the safety net")
  assert.deepEqual(journalPlan({ ...working, lastReadAt: now - 49 * HOUR }, now, "auto"), { read: true, full: true }, "the journal keeps three days")
})

test("parse and apply: log ids move forward, logs at or below the cursor are ignored, orders named once", () => {
  const logs = parseJournal([
    { log_id: 12, log_type: 18, order_id: 501, object_id: 5, date: 100 },
    { log_id: 11, log_type: 9, order_id: 501, object_id: 77, date: 90 },
    { id: 13, log_type: 18, order_id: "502", date: 110 },
    { log_id: 9, log_type: 18, order_id: 503, date: 80 },
    { log_id: 14, log_type: 2, order_id: 504, date: 120 },
    "junk",
  ])
  assert.deepEqual(
    logs.map((l) => l.logId),
    [9, 11, 12, 13, 14],
  )
  const { state, orderIds } = applyJournal({ ...emptyJournal(), lastLogId: 10 }, logs, 5000)
  assert.deepEqual(orderIds, ["501", "502"], "type 2 (DOF download) is not a status event; log 9 is old")
  assert.equal(state.lastLogId, 14)
  assert.equal(state.everEvents, true)
  assert.equal(state.lastReadAt, 5000)
  const empty = applyJournal(state, [], 6000)
  assert.equal(empty.state.lastLogId, 14)
  assert.deepEqual(empty.orderIds, [])
  assert.equal(journalHealth(null, "auto", false), "unknown")
  assert.equal(journalHealth({ ...emptyJournal(), lastReadAt: 1 }, "auto", false), "empty")
  assert.equal(journalHealth(state, "auto", false), "active")
  assert.equal(journalHealth(state, "auto", true), "demo")
})

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

test("status pass: the journal names the orders, only they are read; an error falls back to the full read", async () => {
  let journal: Row[] = [{ log_id: 100, log_type: 18, order_id: 501, date: 1 }]
  let journalFails = false
  const bl = scriptedBaseLinker({
    getJournalList: () => (journalFails ? { status: "ERROR", error_code: "ERROR_METHOD_DISABLED", error_message: "journal disabled" } : { logs: journal }),
    getOrderStatusList: () => ({ statuses: [{ id: 5, name: "Wysłane" }] }),
    getOrders: (p) => ({ orders: [{ order_id: p.order_id, order_status_id: 5, delivery_package_nr: "", delivery_package_module: "" }] }),
  })
  restore = bl.restore
  const s = fakeService({ apiToken: "t0ken-t0ken-t0ken", inventoryId: 1, orderStatusId: 1, warehouseId: "bl_1" })
  for (const id of ["501", "502", "503"]) s.table("Orders").create({ order_id: `order_${id}`, bl_order_id: id, status: "sent", sent_at: new Date(), demo: false })
  const container = fakeContainer({
    baselinker: s.svc,
    order: { retrieveOrder: async (id: string) => ({ id, metadata: {} }), updateOrders: async () => undefined },
    event_bus: silentEvents().bus,
  })
  const reads = () => bl.calls.filter((c) => c.method === "getOrders").map((c) => c.params.order_id)

  const first = await runStatusPass(container, "schedule")
  assert.equal(first.mode, "full", "the first read sets the cursor and reads everything")
  assert.equal(reads().length, 3)

  bl.calls.length = 0
  journal = [{ log_id: 101, log_type: 18, order_id: 502, date: 2 }]
  /* The full read just ran, and the journal has proved itself: only the named order is read. */
  const second = await runStatusPass(container, "schedule")
  assert.equal(second.mode, "journal")
  assert.deepEqual(reads(), [502])
  assert.equal(bl.calls.find((c) => c.method === "getJournalList")?.params.last_log_id, 100)

  bl.calls.length = 0
  journalFails = true
  const third = await runStatusPass(container, "schedule")
  assert.equal(third.mode, "full")
  assert.match(String(third.journalError), /journal disabled/)
  assert.equal(reads().length, 3)
})
