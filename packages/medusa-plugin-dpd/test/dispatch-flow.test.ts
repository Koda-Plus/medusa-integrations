/**
 * The handover to the courier end to end on the memory store, the fake
 * fulfillment module and the fake DPDServices (stage 4, flow): the writers
 * and the plan hash of a create, the handover marker written before the
 * protocol and cleared only by the print that wrote it, the courier ordered
 * once (live against the fake, where the sandbox would simulate it), an
 * unclear answer that a person resolves, changes and cancellations with the
 * stored checkSum, withdraw, cancel, do not send, and the pass. No network.
 */
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { COURIER_CHECKSUM_MAX, COURIER_LEASE_MS, PROTOCOL_LEASE_MS } from "../src/modules/dpd/lib/constants.ts"
import { courierDays } from "../src/modules/dpd/lib/courier.ts"
import { hasMarker, markerData } from "../src/modules/dpd/lib/dispatch.ts"
import type { DpdServicesClient } from "../src/modules/dpd/lib/dpdservices.ts"
import { toDispatchDto, type DispatchRow } from "../src/modules/dpd/lib/dto.ts"
import type { DpdPluginOptions } from "../src/modules/dpd/lib/options.ts"
import {
  cancelCourier,
  cancelDispatch,
  createDispatch,
  dispatchView,
  excludeShipment,
  expireDispatches,
  orderCourier,
  planDispatch,
  printProtocol,
  rescheduleCourier,
  resolveDispatch,
  restoreShipment,
  withdrawShipment,
  type DispatchView,
} from "../src/workflows/dpd/dispatch.ts"
import { clientFor } from "../src/workflows/dpd/runtime.ts"
import { dispatchDtos, dispatchResponse } from "../src/api/admin/dpd/helpers.ts"
import { FakeDpdServices } from "./fake-dpdservices.ts"
import { arm, cancelFulfillment, insertLabeled, labeledOrder, SANDBOX, setup, type Row, type Setup } from "./helpers.ts"

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
  assert.equal(requests, 0, "only the fake DPDServices is ever called")
})

const ADMIN = "user_01ADMIN"
/* Courier flows run in live against the fake: in sandbox clientFor puts the simulator in front of every client (14.1). */
const LIVE: DpdPluginOptions = { ...SANDBOX, mode: "live", shipmentWriter: true, pickupWriter: true }

type World = { s: Setup; fake: FakeDpdServices; ids: string[]; fulfillments: string[] }

function world(n = 2, opts: { options?: DpdPluginOptions; courier?: "demo" | "works"; armed?: boolean } = {}): World {
  const fake = new FakeDpdServices({ courier: opts.courier ?? "works" })
  const s = setup(opts.options ?? LIVE, [], { fake })
  if (opts.armed !== false) {
    arm(s, "shipment")
    arm(s, "pickup")
  }
  const rows = Array.from({ length: n }, (_, i) => insertLabeled(s, labeledOrder(i + 1)))
  return { s, fake, ids: rows.map((r) => String(r.id)), fulfillments: rows.map((r) => String(r.fulfillment_id)) }
}

async function created(w: World, print = false): Promise<DispatchView> {
  const { plan } = await planDispatch(w.s.container, w.ids)
  assert.ok(plan.ok, JSON.stringify(plan.problems))
  return createDispatch(w.s.container, { shipmentIds: w.ids, planHash: plan.hash, print }, { actor: ADMIN })
}

async function printed(w: World): Promise<DispatchView> {
  const view = await created(w, true)
  assert.equal(view.dispatch.state, "printed", String(view.dispatch.error))
  return view
}

function windowOf(from = "10:00", to = "13:00", now = new Date()) {
  return { pickupDate: courierDays(now)[1], pickupTimeFrom: from, pickupTimeTo: to }
}

async function ordered(w: World): Promise<DispatchView> {
  const view = await printed(w)
  const after = await orderCourier(w.s.container, view.dispatch.id, windowOf(), { actor: ADMIN })
  return after
}

function dispatchRow(s: Setup, id: string): Row {
  const row = s.dispatches.rows.find((r) => r.id === id)
  assert.ok(row)
  return row
}

function shipment(s: Setup, id: string): Row {
  const row = s.shipments.rows.find((r) => r.id === id)
  assert.ok(row)
  return row
}

function dataOf(s: Setup, fulfillmentId: string): Row {
  const f = s.fulfillments.get(fulfillmentId)
  assert.ok(f)
  return f.data
}

function actions(s: Setup, dispatchId: string): string[] {
  return s.events.rows.filter((e) => e.dispatch_id === dispatchId && e.shipment_id === null).map((e) => String((e.data as Row | null)?.action ?? ""))
}

function dto(view: DispatchView) {
  return toDispatchDto(view.dispatch, view.shipments, { canOrder: true, simulated: false })
}

async function refusedWith(work: Promise<unknown>, status: number, code: string): Promise<void> {
  await assert.rejects(work, (err: unknown) => {
    const e = err as { status?: number; code?: string; message?: string }
    assert.equal(e.code, code, e.message)
    assert.equal(e.status, status)
    return true
  })
}

/* ------------------------------------------------------------------ */
/* Create and print                                                    */
/* ------------------------------------------------------------------ */

test("createDispatch needs the shipment writer and the plan hash", async () => {
  const off = world(1, { options: { ...LIVE, shipmentWriter: false } })
  const { plan: offPlan } = await planDispatch(off.s.container, off.ids)
  await refusedWith(createDispatch(off.s.container, { shipmentIds: off.ids, planHash: offPlan.hash }, { actor: ADMIN }), 409, "writer_off")

  const w = world(2, { armed: false })
  const { plan } = await planDispatch(w.s.container, w.ids)
  await refusedWith(createDispatch(w.s.container, { shipmentIds: w.ids, planHash: plan.hash }, { actor: ADMIN }), 409, "not_armed")
  arm(w.s, "shipment")
  await refusedWith(createDispatch(w.s.container, { shipmentIds: w.ids, planHash: "not-the-hash" }, { actor: ADMIN }), 409, "plan_changed")
  assert.equal(w.s.dispatches.rows.length, 0)

  const view = await createDispatch(w.s.container, { shipmentIds: w.ids, planHash: plan.hash }, { actor: ADMIN })
  assert.equal(view.dispatch.state, "pending")
  assert.deepEqual(view.shipments.map((x) => x.id), w.ids)
  for (const id of w.ids) assert.equal(shipment(w.s, id).dispatch_id, view.dispatch.id)
  assert.equal(w.fake.calls.length, 0, "creating a dispatch never calls DPD")
  assert.deepEqual(actions(w.s, view.dispatch.id), ["dispatch_created"])
  await refusedWith(createDispatch(w.s.container, { shipmentIds: w.ids, planHash: plan.hash }, { actor: ADMIN }), 422, "plan_problems")

  /* The plan passed, then another dispatch took a shipment before the insert: the store says null. */
  const race = world(1)
  const { plan: racePlan } = await planDispatch(race.s.container, race.ids)
  const insert = race.s.store.createDispatch.bind(race.s.store)
  race.s.store.createDispatch = async (row, ids) => {
    shipment(race.s, race.ids[0]).dispatch_id = "dpddsp_OTHER"
    return insert(row, ids)
  }
  await refusedWith(createDispatch(race.s.container, { shipmentIds: race.ids, planHash: racePlan.hash }, { actor: ADMIN }), 409, "plan_changed")
  assert.equal(race.s.dispatches.rows.length, 0)
})

test("first print writes the markers before generateProtocol", async () => {
  const w = world(2)
  const view = await printed(w)
  const protocolAt = w.fake.calls.findIndex((c) => c.op === "protocol")
  assert.equal(protocolAt, 0)
  const markers = w.s.fulfillmentUpdates.filter((u) => typeof (u.data.data as Row | undefined)?.dpd_dispatch_id === "string")
  assert.equal(markers.length, 2)
  for (const m of markers) assert.ok(m.at <= protocolAt, "the marker is written before the protocol call")
  for (const f of w.fulfillments) {
    assert.equal(dataOf(w.s, f).dpd_dispatch_id, view.dispatch.id)
    assert.ok(hasMarker(dataOf(w.s, f)))
    assert.ok(dataOf(w.s, f).dpd_shipment_id, "the other provider data stays (shallow merge)")
  }
  for (const id of w.ids) assert.ok(shipment(w.s, id).handed_over_at)
  assert.equal(w.s.documents.rows.filter((d) => d.type === "protocol").length, 1)
  assert.deepEqual(actions(w.s, view.dispatch.id), ["dispatch_created", "protocol_printed"])
})

test("a fulfillment canceled after the marker: plan_changed, markers cleared, nothing sent", async () => {
  const w = world(2)
  const view = await created(w)
  w.s.fulfillmentFaults.beforeUpdate = (id, data) => {
    if (id === w.fulfillments[1] && typeof (data.data as Row | undefined)?.dpd_dispatch_id === "string") cancelFulfillment(w.s, id)
  }
  await refusedWith(printProtocol(w.s.container, view.dispatch.id, { actor: ADMIN }), 409, "plan_changed")
  assert.equal(w.fake.count("protocol"), 0)
  const row = dispatchRow(w.s, view.dispatch.id)
  assert.equal(row.state, "pending")
  assert.equal(row.error_code, "plan_changed")
  for (const f of w.fulfillments) assert.equal(hasMarker(dataOf(w.s, f)), false, f)
})

test("a marker write failure: marker_failed, the written markers cleared, nothing sent, the dispatch stays pending", async () => {
  const w = world(2)
  const view = await created(w)
  w.s.fulfillmentFaults.update.add(w.fulfillments[1])
  await refusedWith(printProtocol(w.s.container, view.dispatch.id, { actor: ADMIN }), 503, "marker_failed")
  w.s.fulfillmentFaults.update.clear()
  assert.equal(w.fake.count("protocol"), 0)
  const row = dispatchRow(w.s, view.dispatch.id)
  assert.equal(row.state, "pending")
  assert.equal(row.error_code, "marker_failed")
  assert.equal(row.attempts, 0, "a claim that sent nothing is not counted")
  for (const f of w.fulfillments) assert.equal(hasMarker(dataOf(w.s, f)), false, f)
})

test("refused and unclear first print clear the markers and go back to pending", async () => {
  const w = world(2)
  const view = await created(w)
  w.fake.packages.delete(w.fulfillments[0])
  const refused = await printProtocol(w.s.container, view.dispatch.id, { actor: ADMIN })
  assert.equal(refused.dispatch.state, "pending")
  assert.ok(refused.dispatch.error_code)
  for (const f of w.fulfillments) assert.equal(hasMarker(dataOf(w.s, f)), false)
  for (const id of w.ids) assert.equal(shipment(w.s, id).handed_over_at, null)

  const u = world(1)
  const uv = await created(u)
  u.fake.failNext("protocol", "timeout")
  const unclear = await printProtocol(u.s.container, uv.dispatch.id, { actor: ADMIN })
  assert.equal(unclear.dispatch.state, "pending")
  assert.equal(unclear.dispatch.error_code, "protocol_unclear")
  assert.equal(hasMarker(dataOf(u.s, u.fulfillments[0])), false)
  assert.ok(actions(u.s, uv.dispatch.id).includes("protocol_unclear"))
})

test("a first print whose lease expired does not clear the markers of a newer print", async () => {
  const w = world(2)
  const view = await created(w)
  const client = w.s.container.resolve<DpdServicesClient>("dpdServicesClient")
  const original = client.generateProtocol.bind(client)
  const t0 = Date.now()
  const later = new Date(t0 + PROTOCOL_LEASE_MS + 60_000)
  let first = true
  client.generateProtocol = async (req) => {
    if (first) {
      first = false
      assert.equal(await expireDispatches(w.s.container, "live", new Date(t0 + PROTOCOL_LEASE_MS + 1000)), 1)
      assert.equal(dispatchRow(w.s, view.dispatch.id).state, "pending")
      const fresh = await printProtocol(w.s.container, view.dispatch.id, { actor: ADMIN, now: later })
      assert.equal(fresh.dispatch.state, "printed")
    }
    return original(req)
  }
  const late = await printProtocol(w.s.container, view.dispatch.id, { actor: ADMIN, now: new Date(t0) })
  assert.equal(late.dispatch.state, "printed")
  const mine = markerData(view.dispatch.id, later)
  for (const f of w.fulfillments) {
    assert.equal(dataOf(w.s, f).dpd_handed_over_at, mine.dpd_handed_over_at, "the newer print's marker stays")
    assert.equal(dataOf(w.s, f).dpd_dispatch_id, view.dispatch.id)
  }
  assert.equal((dispatchRow(w.s, view.dispatch.id).protocols as unknown[]).length, 1, "the late document is not in the column (E6)")
})

test("the first print stops with marker_failed when its own marker is gone before generateProtocol", async () => {
  const w = world(2)
  const view = await created(w)
  const mod = w.s.container.resolve<{ listFulfillments: (f: Row, c?: Row) => Promise<Row[]> }>("fulfillment")
  const list = mod.listFulfillments
  let reads = 0
  mod.listFulfillments = async (f, c) => {
    reads += 1
    const rows = await list(f, c)
    if (reads !== 2) return rows
    return rows.map((r) => ({ ...r, data: { ...(r.data as Row), dpd_dispatch_id: null, dpd_handed_over_at: null } }))
  }
  await refusedWith(printProtocol(w.s.container, view.dispatch.id, { actor: ADMIN }), 503, "marker_failed")
  assert.equal(w.fake.count("protocol"), 0)
  assert.equal(dispatchRow(w.s, view.dispatch.id).state, "pending")
  assert.equal(dispatchRow(w.s, view.dispatch.id).error_code, "marker_failed")
})

test("a print while the pass clears an expired first print gets busy; the pass hands the row back to pending after clearing", async () => {
  const w = world(2)
  const view = await created(w)
  const at = new Date(Date.now() - 10 * 60_000)
  const marker = markerData(view.dispatch.id, at)
  for (const f of w.fulfillments) Object.assign(dataOf(w.s, f), marker)
  Object.assign(dispatchRow(w.s, view.dispatch.id), {
    state: "printing",
    claim_token: "old-token",
    lease_until: new Date(at.getTime() + PROTOCOL_LEASE_MS),
    error: "Printing the protocol took longer than its lease; print it again.",
    error_code: "protocol_unclear",
  })
  const mod = w.s.container.resolve<{ updateFulfillment: (id: string, d: Row) => Promise<Row> }>("fulfillment")
  const update = mod.updateFulfillment
  let tried = false
  mod.updateFulfillment = async (id, d) => {
    if (!tried) {
      tried = true
      await refusedWith(printProtocol(w.s.container, view.dispatch.id, { actor: ADMIN }), 409, "busy")
    }
    return update(id, d)
  }
  assert.equal(await expireDispatches(w.s.container, "live", new Date()), 1)
  assert.ok(tried)
  const row = dispatchRow(w.s, view.dispatch.id)
  assert.equal(row.state, "pending")
  assert.equal(row.error_code, "protocol_unclear")
  assert.equal(row.claim_token, null)
  for (const f of w.fulfillments) assert.equal(hasMarker(dataOf(w.s, f)), false)
  assert.equal(w.fake.count("protocol"), 0, "the pass never prints")
  assert.ok(actions(w.s, view.dispatch.id).includes("dispatch_lease_expired"))
})

test("reprint makes a new document and keeps the markers", async () => {
  const w = world(1)
  const view = await printed(w)
  const marker = { ...dataOf(w.s, w.fulfillments[0]) }
  const updates = w.s.fulfillmentUpdates.length
  const again = await printProtocol(w.s.container, view.dispatch.id, { actor: ADMIN })
  assert.equal(again.dispatch.state, "printed")
  assert.equal(w.fake.count("protocol"), 2)
  assert.equal((again.dispatch.protocols as unknown[]).length, 2)
  assert.equal(w.s.fulfillmentUpdates.length, updates, "a reprint writes no marker")
  assert.equal(dataOf(w.s, w.fulfillments[0]).dpd_handed_over_at, marker.dpd_handed_over_at)
  assert.ok(actions(w.s, view.dispatch.id).includes("protocol_reprinted"))
})

/* ------------------------------------------------------------------ */
/* The courier                                                         */
/* ------------------------------------------------------------------ */

test("order: fresh availability, window outside the ranges is courier_window, nothing sent", async () => {
  const w = world(1)
  const view = await printed(w)
  await refusedWith(orderCourier(w.s.container, view.dispatch.id, windowOf("18:00", "19:00"), { actor: ADMIN }), 422, "courier_window")
  assert.equal(w.fake.count("availability"), 1)
  assert.equal(w.fake.count("pickupCreate"), 0)
  assert.equal(dispatchRow(w.s, view.dispatch.id).state, "printed")
  await refusedWith(orderCourier(w.s.container, view.dispatch.id, { pickupDate: "2026-02-30", pickupTimeFrom: "10:00", pickupTimeTo: "12:00" }, { actor: ADMIN }), 422, "courier_window")
  assert.equal(w.fake.count("availability"), 1, "a malformed window is refused before the availability call")
})

test("order in live against the fake: ordered with order number and checkSum, checkSum never in the DTO", async () => {
  const w = world(2)
  const view = await ordered(w)
  assert.equal(view.dispatch.state, "ordered", String(view.dispatch.error))
  assert.ok(view.dispatch.order_number)
  const checkSum = String(view.dispatch.check_sum)
  assert.ok(checkSum.length >= 8 && checkSum.length <= COURIER_CHECKSUM_MAX)
  assert.equal(w.fake.count("pickupCreate"), 1)
  const out = dto(view)
  assert.equal(out.hasCheckSum, true)
  assert.equal(out.orderNumber, view.dispatch.order_number)
  assert.ok(!JSON.stringify(out).includes(checkSum), "the checkSum never leaves the server")
  assert.ok(!JSON.stringify(w.s.events.rows).includes(checkSum), "nor goes to the history")
  assert.ok(!w.s.logs.join("\n").includes(checkSum), "nor to the log")
  const event = w.s.events.rows.find((e) => (e.data as Row | null)?.action === "courier_ordered")
  assert.equal((event?.data as Row).orderNumber, view.dispatch.order_number)
  assert.equal((event?.data as Row).simulated, false)
})

test("order with 12a answer: unknown, then resolve ordered or not_ordered", async () => {
  const w = world(1, { courier: "demo" })
  const view = await ordered(w)
  assert.equal(view.dispatch.state, "unknown")
  assert.equal(view.dispatch.error_code, "order_unclear")
  assert.equal(dto(view).attention, true)
  await refusedWith(orderCourier(w.s.container, view.dispatch.id, windowOf(), { actor: ADMIN }), 409, "wrong_state")
  assert.equal(w.fake.count("pickupCreate"), 1, "never ordered twice")
  const resolved = await resolveDispatch(w.s.container, view.dispatch.id, { outcome: "ordered", orderNumber: "ORD-000123" }, { actor: ADMIN })
  assert.equal(resolved.dispatch.state, "ordered")
  assert.equal(resolved.dispatch.order_number, "ORD-000123")
  assert.equal(resolved.dispatch.check_sum, null)
  assert.equal(dto(resolved).hasCheckSum, false)

  const n = world(1, { courier: "demo" })
  const nv = await ordered(n)
  const back = await resolveDispatch(n.s.container, nv.dispatch.id, { outcome: "not_ordered" }, { actor: ADMIN })
  assert.equal(back.dispatch.state, "printed")
  assert.equal(back.dispatch.pickup_date, null)
  assert.equal(back.dispatch.order_number, null)
  assert.equal(n.fake.count("pickupCreate"), 1)
})

test("resolve also clears update_unclear and cancel_unclear on ordered", async () => {
  const w = world(1)
  const view = await ordered(w)
  const checkSum = view.dispatch.check_sum
  w.fake.failNext("pickupUpdate", "timeout")
  const unclear = await rescheduleCourier(w.s.container, view.dispatch.id, windowOf("13:00", "16:00"), { actor: ADMIN })
  assert.equal(unclear.dispatch.state, "ordered")
  assert.equal(unclear.dispatch.error_code, "update_unclear")
  assert.equal(dto(unclear).attention, true)
  assert.equal(dto(unclear).actions.resolve, true)
  const cleared = await resolveDispatch(w.s.container, view.dispatch.id, { outcome: "ordered" }, { actor: ADMIN })
  assert.equal(cleared.dispatch.error_code, null)
  assert.equal(cleared.dispatch.check_sum, checkSum)

  w.fake.failNext("pickupDelete", "timeout")
  const cancelUnclear = await cancelCourier(w.s.container, view.dispatch.id, { actor: ADMIN })
  assert.equal(cancelUnclear.dispatch.error_code, "cancel_unclear")
  const again = await resolveDispatch(w.s.container, view.dispatch.id, { outcome: "ordered" }, { actor: ADMIN })
  assert.equal(again.dispatch.state, "ordered")
  assert.equal(again.dispatch.error_code, null)
})

test("ordered without a checkSum: resolve not_ordered goes back to printed with the order fields cleared; resolve ordered only stores the number; the row is never attention", async () => {
  const w = world(2, { courier: "demo" })
  const view = await ordered(w)
  const resolved = await resolveDispatch(w.s.container, view.dispatch.id, { outcome: "ordered" }, { actor: ADMIN })
  assert.equal(resolved.dispatch.state, "ordered")
  assert.equal(resolved.dispatch.check_sum, null)
  assert.equal(dto(resolved).actions.resolve, true)
  assert.equal(dto(resolved).attention, false)
  assert.equal((await w.s.store.dispatchCounts("live")).attention, 0)
  const numbered = await resolveDispatch(w.s.container, view.dispatch.id, { outcome: "ordered", orderNumber: "ORD-000777" }, { actor: ADMIN })
  assert.equal(numbered.dispatch.order_number, "ORD-000777")
  await refusedWith(cancelDispatch(w.s.container, view.dispatch.id, { actor: ADMIN }), 409, "wrong_state")
  await refusedWith(withdrawShipment(w.s.container, w.ids[0], { actor: ADMIN }), 409, "no_check_sum")
  const back = await resolveDispatch(w.s.container, view.dispatch.id, { outcome: "not_ordered" }, { actor: ADMIN })
  assert.equal(back.dispatch.state, "printed")
  for (const k of ["ordered_at", "order_number", "check_sum", "pickup_date", "pickup_time_from", "pickup_time_to"] as const) assert.equal(back.dispatch[k], null, k)
  const out = await withdrawShipment(w.s.container, w.ids[0], { actor: ADMIN })
  assert.equal(out.withdrawn, true)
  const canceled = await cancelDispatch(w.s.container, view.dispatch.id, { actor: ADMIN })
  assert.equal(canceled.dispatch.state, "canceled")

  const k = world(1)
  const kv = await ordered(k)
  await refusedWith(resolveDispatch(k.s.container, kv.dispatch.id, { outcome: "ordered" }, { actor: ADMIN }), 409, "wrong_state")
})

test("an order canceled in DPD: PATCH gets order_status, the dispatch shows attention and actions.resolve; not_ordered goes back to printed", async () => {
  const w = world(1)
  const view = await ordered(w)
  const order = w.fake.orders.get(String(view.dispatch.order_number))
  assert.ok(order)
  order.canceled = true
  const refused = await rescheduleCourier(w.s.container, view.dispatch.id, windowOf("13:00", "16:00"), { actor: ADMIN })
  assert.equal(refused.dispatch.state, "ordered")
  assert.equal(refused.dispatch.error_code, "order_status")
  assert.equal(dto(refused).attention, true)
  assert.equal(dto(refused).actions.resolve, true)
  const back = await resolveDispatch(w.s.container, view.dispatch.id, { outcome: "not_ordered" }, { actor: ADMIN })
  assert.equal(back.dispatch.state, "printed")
  assert.equal(back.dispatch.check_sum, null)
})

test("reschedule sends PATCH with the stored checkSum; no checkSum: no_check_sum", async () => {
  const w = world(1)
  const view = await ordered(w)
  const stored = view.dispatch.check_sum
  const same = await rescheduleCourier(w.s.container, view.dispatch.id, windowOf(), { actor: ADMIN })
  assert.equal(same.dispatch.state, "ordered")
  assert.equal(w.fake.count("pickupUpdate"), 0, "the same window is no call")
  const moved = await rescheduleCourier(w.s.container, view.dispatch.id, windowOf("13:00", "16:00"), { actor: ADMIN })
  const patch = w.fake.calls.find((c) => c.op === "pickupUpdate")
  assert.equal((patch?.body as Row).checkSum, stored)
  assert.equal(moved.dispatch.pickup_time_from, "13:00")
  assert.notEqual(moved.dispatch.check_sum, stored, "the rotated checkSum is stored")

  const d = world(1, { courier: "demo" })
  const dv = await ordered(d)
  await resolveDispatch(d.s.container, dv.dispatch.id, { outcome: "ordered" }, { actor: ADMIN })
  await refusedWith(rescheduleCourier(d.s.container, dv.dispatch.id, windowOf("13:00", "16:00"), { actor: ADMIN }), 409, "no_check_sum")
  await refusedWith(cancelCourier(d.s.container, dv.dispatch.id, { actor: ADMIN }), 409, "no_check_sum")
})

test("cancelCourier sends DELETE and goes back to printed with ordered_at cleared", async () => {
  const w = world(1)
  const view = await ordered(w)
  const after = await cancelCourier(w.s.container, view.dispatch.id, { actor: ADMIN })
  const del = w.fake.calls.find((c) => c.op === "pickupDelete")
  assert.equal(del?.query?.orderNumber, view.dispatch.order_number)
  assert.equal(after.dispatch.state, "printed")
  assert.equal(after.dispatch.ordered_at, null)
  assert.equal(after.dispatch.order_number, null)
  assert.equal(after.dispatch.check_sum, null)
  assert.ok(shipment(w.s, w.ids[0]).handed_over_at, "the shipments stay handed over")
})

/* ------------------------------------------------------------------ */
/* Withdraw, cancel, view                                              */
/* ------------------------------------------------------------------ */

test("withdraw from printed releases the shipment and clears its marker; protocol_stale appears", async () => {
  const w = world(2)
  const view = await printed(w)
  const out = await withdrawShipment(w.s.container, w.ids[0], { actor: ADMIN })
  assert.equal(out.withdrawn, true)
  assert.deepEqual(out.warnings.map((p) => p.code), ["protocol_stale"])
  assert.equal(shipment(w.s, w.ids[0]).dispatch_id, null)
  assert.equal(shipment(w.s, w.ids[0]).handed_over_at, null)
  assert.equal(hasMarker(dataOf(w.s, w.fulfillments[0])), false)
  assert.equal(hasMarker(dataOf(w.s, w.fulfillments[1])), true)
  const after = await dispatchView(w.s.container, view.dispatch.id)
  assert.deepEqual(after.dispatch.shipment_ids, [w.ids[1]])
  assert.equal(dto(after).protocols[0]?.stale, true)
  assert.equal(w.fake.calls.filter((c) => c.op !== "protocol").length, 0, "a local withdraw calls nothing")
})

test("two concurrent withdraws: the second gets plan_changed", async () => {
  const w = world(3)
  const view = await created(w)
  const transition = w.s.store.transitionDispatch.bind(w.s.store)
  let arrived = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  w.s.store.transitionDispatch = async (id, from, patch, expect) => {
    arrived += 1
    if (arrived === 2) release()
    await gate
    return transition(id, from, patch, expect)
  }
  const results = await Promise.allSettled([withdrawShipment(w.s.container, w.ids[0], { actor: ADMIN }), withdrawShipment(w.s.container, w.ids[1], { actor: ADMIN })])
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
  const lost = results.find((r) => r.status === "rejected")
  assert.equal((lost as PromiseRejectedResult).reason.code, "plan_changed")
  const pinned = w.s.shipments.rows.filter((r) => r.dispatch_id === view.dispatch.id).map((r) => String(r.id)).sort()
  assert.deepEqual([...(dispatchRow(w.s, view.dispatch.id).shipment_ids as string[])].sort(), pinned)
})

test("an attention code set or cleared between a step's read and its claim is never written back from the stale read (P10)", async () => {
  /* Runs `meanwhile` once, right before the next claim, as a concurrent action would. */
  const before = (w: World, meanwhile: () => Promise<unknown>) => {
    const claim = w.s.store.claimDispatch.bind(w.s.store)
    let ran = false
    w.s.store.claimDispatch = async (id, from, args) => {
      if (!ran) {
        ran = true
        await meanwhile()
      }
      return claim(id, from, args)
    }
  }

  /* A resolve clears update_unclear while a reprint waits for its claim: the reprint must not bring the code back. */
  const a = world(1)
  const av = await ordered(a)
  a.fake.failNext("pickupUpdate", "timeout")
  await rescheduleCourier(a.s.container, av.dispatch.id, windowOf("13:00", "16:00"), { actor: ADMIN })
  assert.equal(dispatchRow(a.s, av.dispatch.id).error_code, "update_unclear")
  before(a, () => resolveDispatch(a.s.container, av.dispatch.id, { outcome: "ordered" }, { actor: ADMIN }))
  const protocols = a.fake.count("protocol")
  await refusedWith(printProtocol(a.s.container, av.dispatch.id, { actor: ADMIN }), 409, "plan_changed")
  assert.equal(dispatchRow(a.s, av.dispatch.id).error_code, null, "the resolve stays")
  assert.equal(a.fake.count("protocol"), protocols, "nothing sent")

  /* A refused PATCH sets order_status while a reprint, a reschedule, a cancel or a withdraw waits for its claim: the code stays. */
  const steps: Array<[string, (w: World, id: string) => Promise<unknown>]> = [
    ["print", (w, id) => printProtocol(w.s.container, id, { actor: ADMIN })],
    ["reschedule", (w, id) => rescheduleCourier(w.s.container, id, windowOf("14:00", "17:00"), { actor: ADMIN })],
    ["cancel", (w, id) => cancelCourier(w.s.container, id, { actor: ADMIN })],
    ["withdraw", (w) => withdrawShipment(w.s.container, w.ids[0], { actor: ADMIN })],
  ]
  for (const [name, step] of steps) {
    const w = world(2)
    const view = await ordered(w)
    const id = view.dispatch.id
    before(w, async () => {
      const order = w.fake.orders.get(String(view.dispatch.order_number))
      assert.ok(order)
      order.canceled = true
      await rescheduleCourier(w.s.container, id, windowOf("13:00", "16:00"), { actor: ADMIN })
    })
    await refusedWith(step(w, id), 409, "plan_changed")
    const row = dispatchRow(w.s, id)
    assert.equal(row.state, "ordered", name)
    assert.equal(row.error_code, "order_status", `${name} keeps the attention code`)
    assert.equal(row.claim_token, null, name)
  }
})

test("resolve ordered with another order number drops the checkSum; the same number keeps it", async () => {
  const w = world(1)
  const view = await ordered(w)
  const number = String(view.dispatch.order_number)
  w.fake.failNext("pickupUpdate", "timeout")
  await rescheduleCourier(w.s.container, view.dispatch.id, windowOf("13:00", "16:00"), { actor: ADMIN })
  const same = await resolveDispatch(w.s.container, view.dispatch.id, { outcome: "ordered", orderNumber: number }, { actor: ADMIN })
  assert.ok(same.dispatch.check_sum, "the same number keeps the checkSum")
  w.fake.failNext("pickupUpdate", "timeout")
  await rescheduleCourier(w.s.container, view.dispatch.id, windowOf("14:00", "17:00"), { actor: ADMIN })
  const other = await resolveDispatch(w.s.container, view.dispatch.id, { outcome: "ordered", orderNumber: "ORD-999999" }, { actor: ADMIN })
  assert.equal(other.dispatch.order_number, "ORD-999999")
  assert.equal(other.dispatch.check_sum, null)
})

test("the dispatch view shows shipment_canceled for a fulfillment canceled after the protocol; the list does not read fulfillments", async () => {
  const w = world(2)
  const view = await printed(w)
  cancelFulfillment(w.s, w.fulfillments[0])
  const answer = await dispatchResponse(w.s.container, await dispatchView(w.s.container, view.dispatch.id))
  assert.deepEqual(answer.dispatch.shipmentProblems, [{ code: "shipment_canceled", field: `shipments.${w.ids[0]}` }])
  const mod = w.s.container.resolve<{ listFulfillments: (f: Row, c?: Row) => Promise<Row[]> }>("fulfillment")
  const list = mod.listFulfillments
  let reads = 0
  mod.listFulfillments = async (f, c) => {
    reads += 1
    return list(f, c)
  }
  const [listed] = await dispatchDtos(w.s.container, [dispatchRow(w.s, view.dispatch.id) as unknown as DispatchRow])
  assert.deepEqual(listed?.shipmentProblems, [])
  assert.equal(reads, 0)
  w.s.fulfillmentFaults.list = true
  const failing = await dispatchResponse(w.s.container, await dispatchView(w.s.container, view.dispatch.id))
  assert.deepEqual(failing.dispatch.shipmentProblems, [], "a read error never fails the answer")
})

test("withdraw from ordered sends PATCH with fewer parcels; the last shipment sends DELETE and ends canceled", async () => {
  const w = world(2)
  await ordered(w)
  const first = await withdrawShipment(w.s.container, w.ids[0], { actor: ADMIN })
  assert.equal(first.withdrawn, true)
  const patch = w.fake.calls.find((c) => c.op === "pickupUpdate")
  const parcel = (((patch?.body as Row).packagesForCollection as Row).packagesParams as Row).parcel as Row
  assert.equal(parcel.count, 1)
  assert.equal(first.dispatch.state, "ordered")
  assert.deepEqual(first.dispatch.shipment_ids, [w.ids[1]])
  assert.deepEqual(first.warnings.map((p) => p.code), ["protocol_stale"])
  const last = await withdrawShipment(w.s.container, w.ids[1], { actor: ADMIN })
  assert.equal(last.withdrawn, true)
  assert.equal(w.fake.count("pickupDelete"), 1)
  assert.equal(last.dispatch.state, "canceled")
  for (const id of w.ids) assert.equal(shipment(w.s, id).dispatch_id, null)
  for (const f of w.fulfillments) assert.equal(hasMarker(dataOf(w.s, f)), false)
})

test("a reschedule finished between a withdraw's read and its claim: plan_changed, the new window is never sent back (checkSum kept on PATCH)", async () => {
  const w = world(2)
  w.fake.rotateCheckSum = false
  const view = await ordered(w)
  const id = view.dispatch.id
  const claim = w.s.store.claimDispatch.bind(w.s.store)
  let ran = false
  w.s.store.claimDispatch = async (rowId, from, args) => {
    if (!ran) {
      ran = true
      await rescheduleCourier(w.s.container, id, windowOf("14:00", "17:00"), { actor: ADMIN })
    }
    return claim(rowId, from, args)
  }
  await refusedWith(withdrawShipment(w.s.container, w.ids[0], { actor: ADMIN }), 409, "plan_changed")
  const windows = w.fake.calls.filter((c) => c.op === "pickupUpdate").map((c) => `${String((c.body as Row).pickupTimeFrom)}-${String((c.body as Row).pickupTimeTo)}`)
  assert.deepEqual(windows, ["14:00-17:00"], "only the reschedule reached DPD")
  const row = dispatchRow(w.s, id)
  assert.equal(row.pickup_time_from, "14:00")
  assert.equal(row.state, "ordered")
  assert.equal(row.claim_token, null)
  assert.deepEqual(row.shipment_ids, w.ids, "nothing was withdrawn")
  const order = w.fake.orders.get(String(view.dispatch.order_number))
  assert.equal(order?.pickupTimeFrom, "14:00")

  const again = await withdrawShipment(w.s.container, w.ids[0], { actor: ADMIN })
  assert.equal(again.withdrawn, true)
  const last = w.fake.calls.filter((c) => c.op === "pickupUpdate").at(-1)
  assert.equal((last?.body as Row).pickupTimeFrom, "14:00", "the next withdraw sends the stored window")
})

test("a releaseShipments error after a successful PATCH leaves an orphan; withdrawing it again or printing releases it locally without DPD", async () => {
  const w = world(3)
  const view = await ordered(w)
  const release = w.s.store.releaseShipments.bind(w.s.store)
  let fail = true
  w.s.store.releaseShipments = async (id, ids) => {
    if (fail) {
      fail = false
      throw new Error("store down")
    }
    return release(id, ids)
  }
  await assert.rejects(withdrawShipment(w.s.container, w.ids[0], { actor: ADMIN }))
  assert.equal(w.fake.count("pickupUpdate"), 1)
  assert.equal(shipment(w.s, w.ids[0]).dispatch_id, view.dispatch.id, "an orphan: pinned, but not in shipment_ids")
  assert.deepEqual(dispatchRow(w.s, view.dispatch.id).shipment_ids, [w.ids[1], w.ids[2]])
  const repaired = await withdrawShipment(w.s.container, w.ids[0], { actor: ADMIN })
  assert.equal(repaired.withdrawn, true)
  assert.equal(w.fake.count("pickupUpdate"), 1, "the repair sends nothing")
  assert.equal(shipment(w.s, w.ids[0]).dispatch_id, null)
  assert.ok(w.s.events.rows.some((e) => (e.data as Row | null)?.outcome === "repaired" && e.shipment_id === w.ids[0]))

  fail = true
  await assert.rejects(withdrawShipment(w.s.container, w.ids[1], { actor: ADMIN }))
  assert.equal(shipment(w.s, w.ids[1]).dispatch_id, view.dispatch.id)
  const reprinted = await printProtocol(w.s.container, view.dispatch.id, { actor: ADMIN })
  assert.equal(shipment(w.s, w.ids[1]).dispatch_id, null, "the print released the orphan first")
  assert.deepEqual(reprinted.shipments.map((x) => x.id), [w.ids[2]])
  const sent = w.fake.calls.filter((c) => c.op === "protocol").at(-1)
  const packages = ((((sent?.body as Row).protocolSearchParams as Row).session as Row).packages as Row[]).map((p) => p.reference)
  assert.deepEqual(packages, [w.fulfillments[2]])
})

test("toDispatchDto puts dims_unknown and sample_sender into warnings, never into problems", async () => {
  const w = world(1)
  const view = await created(w)
  const row = { ...view.dispatch, problems: [{ code: "dims_unknown" }, { code: "sample_sender" }, { code: "courier_over_50kg" }] }
  const out = toDispatchDto(row, view.shipments, { canOrder: false, simulated: false })
  assert.deepEqual(out.warnings.map((p) => p.code), ["dims_unknown", "sample_sender"])
  assert.deepEqual(out.problems.map((p) => p.code), ["courier_over_50kg"])
  assert.equal(out.params?.dimsKnown ?? false, false)
})

test("cancelDispatch releases every shipment and clears every marker", async () => {
  const w = world(2)
  const view = await printed(w)
  const after = await cancelDispatch(w.s.container, view.dispatch.id, { actor: ADMIN })
  assert.equal(after.dispatch.state, "canceled")
  assert.deepEqual(after.shipments, [])
  for (const id of w.ids) {
    assert.equal(shipment(w.s, id).dispatch_id, null)
    assert.equal(shipment(w.s, id).handed_over_at, null)
  }
  for (const f of w.fulfillments) assert.equal(hasMarker(dataOf(w.s, f)), false)
  assert.ok(actions(w.s, view.dispatch.id).includes("dispatch_canceled"))
  await refusedWith(cancelDispatch(w.s.container, view.dispatch.id, { actor: ADMIN }), 409, "wrong_state")
})

test("exclude and restore", async () => {
  const w = world(0)
  const label = insertLabeled(w.s, labeledOrder(1))
  const fresh = insertLabeled(w.s, labeledOrder(2), { state: "created" })
  const excluded = await excludeShipment(w.s.container, String(fresh.id), { actor: ADMIN })
  assert.equal(excluded.state, "excluded")
  assert.equal((await restoreShipment(w.s.container, String(fresh.id), { actor: ADMIN })).state, "created", "no stored label: created")
  w.s.documents.insert({ shipment_id: label.id, dispatch_id: null, type: "label", page: "A4", document_id: null, data: "<pdf>", mode: "live", created_by: ADMIN })
  assert.equal((await excludeShipment(w.s.container, String(label.id), { actor: ADMIN })).state, "excluded")
  await refusedWith(excludeShipment(w.s.container, String(label.id), { actor: ADMIN }), 409, "not_candidate")
  assert.equal((await restoreShipment(w.s.container, String(label.id), { actor: ADMIN })).state, "labeled", "a stored label: labeled")
  await refusedWith(restoreShipment(w.s.container, String(label.id), { actor: ADMIN }), 409, "not_candidate")

  w.ids = [String(label.id)]
  await created(w)
  await refusedWith(excludeShipment(w.s.container, String(label.id), { actor: ADMIN }), 409, "not_candidate")
  assert.equal(w.fake.calls.length, 0, "do not send never calls DPD")
})

test("expired first print clears the markers", async () => {
  const w = world(2)
  const view = await created(w)
  const at = new Date(Date.now() - 10 * 60_000)
  for (const f of w.fulfillments) Object.assign(dataOf(w.s, f), markerData(view.dispatch.id, at))
  Object.assign(dispatchRow(w.s, view.dispatch.id), {
    state: "printing",
    claim_token: "old-token",
    lease_until: new Date(at.getTime() + PROTOCOL_LEASE_MS),
    error: "Printing the protocol took longer than its lease; print it again.",
    error_code: "protocol_unclear",
  })
  assert.equal(await expireDispatches(w.s.container, "live", new Date()), 1)
  const row = dispatchRow(w.s, view.dispatch.id)
  assert.equal(row.state, "pending")
  assert.equal(row.error_code, "protocol_unclear")
  for (const f of w.fulfillments) assert.equal(hasMarker(dataOf(w.s, f)), false)
  assert.equal(await expireDispatches(w.s.container, "live", new Date()), 0)
})

test("sandbox wraps a registered client with the simulator; live never does", async () => {
  const live = world(0)
  const registered = live.s.container.resolve<DpdServicesClient>("dpdServicesClient")
  assert.equal(clientFor(live.s.container), registered)

  const sbx = world(0, { options: { ...SANDBOX, shipmentWriter: true, pickupWriter: true } })
  const inner = sbx.s.container.resolve<DpdServicesClient>("dpdServicesClient")
  const wrapped = clientFor(sbx.s.container)
  assert.ok(wrapped)
  assert.notEqual(wrapped, inner)
  assert.equal(clientFor(sbx.s.container)?.pickupCallCreate === wrapped.pickupCallCreate, true, "one simulator per client")
})

/* ------------------------------------------------------------------ */
/* A database error after DPD answered                                 */
/* ------------------------------------------------------------------ */

/** The next finishDispatch to the given state throws like a statement timeout (once); the others run. */
function failFinish(s: Setup, state: string): void {
  const finish = s.store.finishDispatch.bind(s.store)
  let failed = false
  s.store.finishDispatch = async (id, token, patch, options) => {
    if (!failed && patch.state === state) {
      failed = true
      throw new Error("canceling statement due to statement timeout")
    }
    return finish(id, token, patch, options)
  }
}

function dispatchEvents(s: Setup, dispatchId: string, action: string): Row[] {
  return s.events.rows.filter((e) => e.dispatch_id === dispatchId && e.shipment_id === null && (e.data as Row | null)?.action === action).map((e) => e.data as Row)
}

function noCheckSumAnywhere(w: World): void {
  for (const order of w.fake.orders.values()) {
    assert.ok(!JSON.stringify(w.s.events.rows).includes(order.checkSum), "no checkSum in the history")
    assert.ok(!w.s.logs.join("\n").includes(order.checkSum), "no checkSum in the log")
  }
}

test("createDispatch with print: a refused print answers with the pending dispatch; any other error of the print is a 500", async () => {
  const refused = world(2)
  refused.s.fulfillmentFaults.update.add(refused.fulfillments[1])
  const view = await created(refused, true)
  assert.equal(view.dispatch.state, "pending")
  assert.equal(view.dispatch.error_code, "marker_failed")
  assert.equal(refused.fake.count("protocol"), 0)

  const down = world(2)
  const create = down.s.store.createDispatch.bind(down.s.store)
  down.s.store.createDispatch = async (row, ids) => {
    const out = await create(row, ids)
    down.s.fulfillmentFaults.list = true
    return out
  }
  await assert.rejects(created(down, true), /fulfillment module down/)
  assert.equal(down.s.dispatches.rows.length, 1, "the dispatch exists")
  assert.equal(down.s.dispatches.rows[0].state, "pending")
  assert.equal(down.fake.count("protocol"), 0)

  const db = world(2)
  failFinish(db.s, "printed")
  await assert.rejects(created(db, true), /statement timeout/)
  assert.equal(db.fake.count("protocol"), 1)
  assert.equal(db.s.dispatches.rows[0].state, "printing", "the lease pass takes it back")
})

test("a database error after DPD ordered the courier: the order number reaches the history and the log; the pass leaves unknown", async () => {
  const w = world(2)
  const view = await printed(w)
  failFinish(w.s, "ordered")
  await assert.rejects(orderCourier(w.s.container, view.dispatch.id, windowOf(), { actor: ADMIN }), /statement timeout/)
  assert.equal(w.fake.count("pickupCreate"), 1)
  const [number] = [...w.fake.orders.keys()]
  assert.ok(number)
  const ordered = dispatchEvents(w.s, view.dispatch.id, "courier_ordered")
  assert.equal(ordered.length, 1)
  assert.equal(ordered[0].orderNumber, number)
  assert.ok(w.s.logs.some((l) => l.startsWith("info") && l.includes(`order number ${number}`)))
  assert.equal(dispatchRow(w.s, view.dispatch.id).state, "ordering")
  assert.equal(await expireDispatches(w.s.container, "live", new Date(Date.now() + COURIER_LEASE_MS + 1000)), 1)
  const row = dispatchRow(w.s, view.dispatch.id)
  assert.equal(row.state, "unknown")
  assert.equal(row.error_code, "order_unclear")
  noCheckSumAnywhere(w)
})

test("a database error after DPD confirmed a PATCH or DELETE: the order number reaches the history under the unclear action", async () => {
  const re = world(2)
  const view = await ordered(re)
  failFinish(re.s, "ordered")
  await assert.rejects(rescheduleCourier(re.s.container, view.dispatch.id, windowOf("14:00", "17:00"), { actor: ADMIN }), /statement timeout/)
  assert.equal(re.fake.count("pickupUpdate"), 1)
  const changed = dispatchEvents(re.s, view.dispatch.id, "courier_update_unclear")
  assert.equal(changed.length, 1)
  assert.ok(changed[0].orderNumber, "the number DPD answered with")
  assert.equal(changed[0].sent, true)
  assert.equal(dispatchEvents(re.s, view.dispatch.id, "courier_rescheduled").length, 0)
  assert.equal(await expireDispatches(re.s.container, "live", new Date(Date.now() + COURIER_LEASE_MS + 1000)), 1)
  assert.equal(dispatchRow(re.s, view.dispatch.id).error_code, "update_unclear")
  noCheckSumAnywhere(re)

  const ca = world(1)
  const cv = await ordered(ca)
  failFinish(ca.s, "printed")
  await assert.rejects(cancelCourier(ca.s.container, cv.dispatch.id, { actor: ADMIN }), /statement timeout/)
  const canceled = dispatchEvents(ca.s, cv.dispatch.id, "courier_cancel_unclear")
  assert.equal(canceled.length, 1)
  assert.equal(canceled[0].orderNumber, cv.dispatch.order_number)
  noCheckSumAnywhere(ca)

  const wp = world(2)
  const pv = await ordered(wp)
  failFinish(wp.s, "ordered")
  await assert.rejects(withdrawShipment(wp.s.container, wp.ids[0], { actor: ADMIN }), /statement timeout/)
  assert.equal(wp.fake.count("pickupUpdate"), 1)
  assert.equal(dispatchEvents(wp.s, pv.dispatch.id, "courier_update_unclear").length, 1)
  assert.equal(dispatchEvents(wp.s, pv.dispatch.id, "shipment_withdrawn").length, 0, "nothing withdrawn here")
  assert.equal(shipment(wp.s, wp.ids[0]).dispatch_id, pv.dispatch.id)
  noCheckSumAnywhere(wp)

  const wd = world(1)
  const dv = await ordered(wd)
  failFinish(wd.s, "canceled")
  await assert.rejects(withdrawShipment(wd.s.container, wd.ids[0], { actor: ADMIN }), /statement timeout/)
  assert.equal(wd.fake.count("pickupDelete"), 1)
  const last = dispatchEvents(wd.s, dv.dispatch.id, "courier_cancel_unclear")
  assert.equal(last.length, 1)
  assert.equal(last[0].orderNumber, dv.dispatch.order_number)
  noCheckSumAnywhere(wd)
})
