/**
 * The flows end to end: recording a fulfillment, the plan, creating a
 * shipment exactly once and only when armed, an answer that never came,
 * statuses and their events, cancelling, a prepaid offer, labels, the edits
 * before sending, the courier pickup. An in-memory store with the rules of
 * the SQL one, a fake Medusa container and a scripted ShipX organization: no
 * database, no network.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  applyShipment,
  buyOffer,
  cancelShipment,
  changeLocker,
  changeSize,
  createShipment,
  labelOf,
  linkShipment,
  lookupUnknown,
  onFulfillmentCanceled,
  planForParcel,
  recordFulfillment,
  refreshParcel,
  requestPickup,
  retryParcel,
  skipParcel,
} from "../src/workflows/inpost/parcels.ts"
import { ActionError } from "../src/workflows/inpost/runtime.ts"
import { runSync } from "../src/workflows/inpost/sync.ts"
import { arm, FakeShipx, LIVE, order, settle, setup, withFulfillment, type Row } from "./helpers.ts"

const LOCKER = { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa", city: "Warszawa", post_code: "00-950" }
const LOCKER_DATA = { type: "paczkomat", cod: false, machine_id: "KSP01M", machine_name: "KSP01M", machine_address: LOCKER, inpost_option: "inpost-paczkomat" }
const FUL = "ful_01TEST0000000000000000001"

function lockerOrder(data: Row = LOCKER_DATA, over: Row = {}): Row {
  return withFulfillment(order(over), data, FUL)
}

async function recorded(s: ReturnType<typeof setup>): Promise<Row> {
  const row = await recordFulfillment(s.container, "order_01KODASUPPLY000000000001", FUL)
  assert.ok(row)
  return row as Row
}

const refusal = (code: string) => (e: unknown) => e instanceof ActionError && e.code === code

test("a fulfillment of another provider is ignored; an InPost one is recorded once, pending, with its plan problems", async () => {
  const other = setup(LIVE, [{ ...lockerOrder(), fulfillments: [{ ...lockerOrder().fulfillments[0], provider_id: "manual_manual" }] }])
  assert.equal(await recordFulfillment(other.container, "order_01KODASUPPLY000000000001", FUL), null)
  const s = setup(LIVE, [lockerOrder()])
  const row = await recorded(s)
  assert.equal(row.state, "pending")
  assert.equal(row.option_id, "inpost-paczkomat")
  assert.equal(row.locker_code, "KSP01M")
  assert.equal(row.parcel_no, 1)
  const again = await recordFulfillment(s.container, "order_01KODASUPPLY000000000001", FUL)
  assert.equal(again?.id, row.id)
  assert.equal(s.parcels.rows.length, 1, "the same fulfillment never makes a second row")
  assert.equal(s.fake.calls.length, 0, "recording sends nothing to InPost")
  assert.equal(s.parcels.rows[0].problems, null)
})

test("an order shipped outside Medusa is skipped; with a shipment id in the key, that shipment is tracked instead", async () => {
  const skip = setup({ ...LIVE, skipMetadataKeys: ["wz_numer", "inpost_shipment"] }, [lockerOrder(LOCKER_DATA, { metadata: { wz_numer: "WZ 12/10/2026" } })])
  const row = await recorded(skip)
  assert.equal(row.state, "skipped")
  assert.equal(row.skip_reason, "wz_numer")
  await assert.rejects(createShipment(skip.container, row.id, { actor: "user_1", trigger: "manual", planHash: "x" }), refusal("not_pending"))
  const fake = new FakeShipx()
  fake.shipments.set("555", { id: 555, status: "confirmed", tracking_number: "6".repeat(24), reference: "OMS" })
  const tracked = setup({ ...LIVE, skipMetadataKeys: ["inpost_shipment"] }, [lockerOrder(LOCKER_DATA, { metadata: { inpost_shipment: { shipment_id: 555 } } })], fake)
  const ext = await recorded(tracked)
  assert.equal(ext.state, "created")
  assert.equal(ext.external, true)
  assert.equal(ext.shipment_id, "555")
  await settle()
  assert.equal(tracked.parcels.rows[0].status, "confirmed", "the external shipment is read, never created")
  assert.equal(fake.calls.filter((c) => c.method === "POST").length, 0)
})

test("creating needs the writer: allowed in the options AND armed in Settings; the person sends the hash of the plan read", async () => {
  const off = setup({ ...LIVE, shipmentWriter: false }, [lockerOrder()])
  const r0 = await recorded(off)
  await assert.rejects(createShipment(off.container, r0.id, { actor: "user_1", trigger: "manual", planHash: "x" }), refusal("writer_off"))
  const s = setup(LIVE, [lockerOrder()])
  const row = await recorded(s)
  await assert.rejects(createShipment(s.container, row.id, { actor: "user_1", trigger: "manual", planHash: "x" }), refusal("not_armed"))
  await arm(s, "shipment")
  await assert.rejects(createShipment(s.container, row.id, { actor: "user_1", trigger: "manual" }), refusal("plan_hash_missing"))
  await assert.rejects(createShipment(s.container, row.id, { actor: "user_1", trigger: "manual", planHash: "0".repeat(24) }), refusal("plan_changed"))
  assert.equal(s.fake.calls.length, 0, "no refusal ever reached ShipX")
})

test("create: the plan's exact request once, the row created, the event once, a second create refused", async () => {
  const s = setup(LIVE, [lockerOrder(LOCKER_DATA)])
  const row = await recorded(s)
  await arm(s, "shipment")
  const { plan } = await planForParcel(s.container, row.id)
  const created = await createShipment(s.container, row.id, { actor: "user_1", trigger: "manual", planHash: plan.hash })
  assert.equal(created.state, "created")
  assert.equal(created.status, "created")
  assert.equal(created.reference, "Order 1042")
  assert.equal(created.created_by, "user_1")
  const posts = s.fake.calls.filter((c) => c.method === "POST")
  assert.equal(posts.length, 1)
  assert.deepEqual(posts[0].body, plan.request)
  assert.deepEqual(s.emitted.map((e) => e.name), ["inpost.shipment.created"])
  assert.equal(s.emitted[0].data.shipment_id, created.shipment_id)
  await assert.rejects(createShipment(s.container, row.id, { actor: "user_1", trigger: "manual", planHash: plan.hash }), refusal("not_pending"))
  assert.equal(s.fake.calls.filter((c) => c.method === "POST").length, 1)
})

test("a plan with problems is never sent and the problems are kept on the row", async () => {
  const s = setup(LIVE, [lockerOrder({ ...LOCKER_DATA, machine_id: null, machine_name: null, machine_address: null })])
  const row = await recorded(s)
  await arm(s, "shipment")
  assert.deepEqual(s.parcels.rows[0].problems, [{ code: "locker_missing" }])
  await assert.rejects(createShipment(s.container, row.id, { actor: "system", trigger: "auto" }), refusal("plan_problems"))
  const fixed = await changeLocker(s.container, row.id, "KSP02A", "user_1", { code: "KSP02A", name: "InPost Paczkomat KSP02A", type: ["parcel_locker"], status: "Operating", address: { line1: "ul. Śrubowa 3", line2: "30-901 Kraków", street: "ul. Śrubowa", building_number: "3", city: "Kraków", post_code: "30-901", province: "" }, location: null, description: null, opening_hours: null, is_24_7: true, payment_available: true, distance: null })
  assert.equal(fixed.locker_code, "KSP02A")
  assert.equal(fixed.problems, null)
  assert.equal(s.fake.calls.length, 0)
})

test("a refused create is failed (retry after a fix); a lost answer is unknown, looked up, and adopted without a second POST", async () => {
  const fake = new FakeShipx()
  const s = setup(LIVE, [lockerOrder()], fake)
  const row = await recorded(s)
  await arm(s, "shipment")
  fake.failCreate = { status: 400 }
  const failed = await createShipment(s.container, row.id, { actor: "system", trigger: "auto" })
  assert.equal(failed.state, "failed")
  assert.match(failed.error ?? "", /receiver\.phone: invalid/)
  const back = await retryParcel(s.container, row.id, "user_1")
  assert.equal(back.state, "pending")
  fake.loseCreateAnswer = true
  const unknown = await createShipment(s.container, row.id, { actor: "system", trigger: "auto" })
  assert.equal(unknown.state, "unknown")
  await assert.rejects(retryParcel(s.container, row.id, "user_1"), refusal("not_failed"), "an unknown row is looked up first")
  const adopted = await lookupUnknown(s.container, row.id)
  assert.equal(adopted.state, "created")
  assert.equal(adopted.error_code, "adopted")
  assert.equal(fake.calls.filter((c) => c.method === "POST").length, 2, "the refused one and the lost one, nothing more")
  assert.equal(s.emitted.filter((e) => e.name === "inpost.shipment.created").length, 1)
})

test("an unknown row with nothing in ShipX becomes failed only a quarter of an hour after the attempt", async () => {
  const s = setup(LIVE, [lockerOrder()])
  const row = await recorded(s)
  await arm(s, "shipment")
  s.fake.failCreate = "timeout"
  const unknown = await createShipment(s.container, row.id, { actor: "system", trigger: "auto" })
  assert.equal(unknown.state, "unknown")
  assert.equal((await lookupUnknown(s.container, row.id)).state, "unknown", "too early to say it was not created")
  s.parcels.rows[0].claimed_at = new Date(Date.now() - 20 * 60 * 1000)
  const failed = await lookupUnknown(s.container, row.id)
  assert.equal(failed.state, "failed")
  assert.equal(failed.error_code, "not_created")
})

test("statuses: compare and set, one history row and one set of events per change, delivered once", async () => {
  const s = setup(LIVE, [lockerOrder()])
  const row = await recorded(s)
  await arm(s, "shipment")
  const { plan } = await planForParcel(s.container, row.id)
  const created = await createShipment(s.container, row.id, { actor: "user_1", trigger: "manual", planHash: plan.hash })
  const id = String(created.shipment_id)
  s.fake.set(id, "confirmed", { tracking_number: "6".repeat(24) })
  await refreshParcel(s.container, row.id, "poll")
  await refreshParcel(s.container, row.id, "poll")
  s.fake.set(id, "ready_to_pickup")
  const stale = { ...s.parcels.rows[0], status: "confirmed" }
  await applyShipment(s.container, stale as never, { status: "ready_to_pickup", tracking_number: "6".repeat(24) }, "webhook")
  await applyShipment(s.container, stale as never, { status: "ready_to_pickup", tracking_number: "6".repeat(24) }, "poll")
  s.fake.set(id, "delivered")
  await refreshParcel(s.container, row.id, "poll")
  await refreshParcel(s.container, row.id, "poll")
  assert.deepEqual(
    s.emitted.map((e) => `${e.name}:${e.data.status}`),
    ["inpost.shipment.created:created", "inpost.shipment.status_changed:confirmed", "inpost.shipment.status_changed:ready_to_pickup", "inpost.shipment.status_changed:delivered", "inpost.shipment.delivered:delivered"],
  )
  assert.equal(s.parcels.rows[0].tracking_number, "6".repeat(24))
  assert.equal(s.events.rows.filter((e) => e.kind === "status").length, 3)
})

test("cancel: only while ShipX allows it, only an armed writer, never a shipment the plugin did not create", async () => {
  const s = setup(LIVE, [lockerOrder()])
  const row = await recorded(s)
  await arm(s, "shipment")
  const { plan } = await planForParcel(s.container, row.id)
  const created = await createShipment(s.container, row.id, { actor: "user_1", trigger: "manual", planHash: plan.hash })
  const canceled = await cancelShipment(s.container, row.id, "user_1")
  assert.equal(canceled.state, "canceled")
  assert.equal(canceled.status, "canceled")
  assert.ok(s.fake.calls.some((c) => c.method === "DELETE"))
  const s2 = setup(LIVE, [lockerOrder()])
  const r2 = await recorded(s2)
  await arm(s2, "shipment")
  const p2 = await planForParcel(s2.container, r2.id)
  const c2 = await createShipment(s2.container, r2.id, { actor: "user_1", trigger: "manual", planHash: p2.plan.hash })
  s2.fake.set(String(c2.shipment_id), "confirmed")
  await assert.rejects(cancelShipment(s2.container, r2.id, "user_1"), (e: unknown) => e instanceof ActionError && /InPost Manager/.test(e.message))
  assert.equal(s2.fake.calls.filter((c) => c.method === "DELETE").length, 0, "the status is read first, no doomed DELETE")
  assert.equal(created.shipment_id !== null, true)
})

test("a prepaid account: offers_prepared from the webhook, the offer of the service bought once, then confirmed", async () => {
  const s = setup(LIVE, [lockerOrder()])
  const row = await recorded(s)
  await arm(s, "shipment")
  const { plan } = await planForParcel(s.container, row.id)
  const created = await createShipment(s.container, row.id, { actor: "user_1", trigger: "manual", planHash: plan.hash })
  const id = String(created.shipment_id)
  s.fake.set(id, "offers_prepared", { offers: [{ id: 901, status: "available", rate: 13.99, currency: "PLN", service: { id: "inpost_locker_standard" } }] })
  await refreshParcel(s.container, row.id, "webhook")
  const buys = s.fake.calls.filter((c) => /\/buy$/.test(c.url))
  assert.equal(buys.length, 1)
  assert.deepEqual(buys[0].body, { offer_id: 901 })
  assert.equal(s.parcels.rows[0].status, "confirmed")
  await assert.rejects(buyOffer(s.container, row.id, { actor: "user_1", trigger: "manual" }), refusal("not_payable"))
})

test("labels: from ShipX once confirmed (A4 is normal for lockers), refused before; the token stays on the server", async () => {
  const s = setup(LIVE, [lockerOrder()])
  const row = await recorded(s)
  await arm(s, "shipment")
  const { plan } = await planForParcel(s.container, row.id)
  const created = await createShipment(s.container, row.id, { actor: "user_1", trigger: "manual", planHash: plan.hash })
  await assert.rejects(labelOf(s.container, row.id, "A6"), refusal("label_not_ready"))
  s.fake.set(String(created.shipment_id), "confirmed")
  await refreshParcel(s.container, row.id, "admin")
  const file = await labelOf(s.container, row.id, "A4")
  assert.equal(file.contentType, "application/pdf")
  assert.equal(file.filename, "inpost-label-Order-1042.pdf")
  assert.match(s.fake.calls.at(-1)?.url ?? "", /type=normal$/)
})

test("edits before sending: the size, skipping, linking a shipment found in InPost Manager", async () => {
  const fake = new FakeShipx()
  fake.shipments.set("777", { id: 777, status: "confirmed", tracking_number: "7".repeat(24), reference: "manual" })
  const s = setup(LIVE, [lockerOrder()], fake)
  const row = await recorded(s)
  assert.equal((await changeSize(s.container, row.id, "large", "user_1")).parcel_size, "large")
  const linked = await linkShipment(s.container, row.id, "777", "user_1")
  assert.equal(linked.state, "created")
  assert.equal(linked.external, true)
  assert.equal(linked.status, "confirmed")
  await assert.rejects(changeSize(s.container, row.id, "small", "user_1"), refusal("already_sent"))
  const s2 = setup(LIVE, [lockerOrder()])
  const r2 = await recorded(s2)
  assert.equal((await skipParcel(s2.container, r2.id, "user_1")).state, "skipped")
  await assert.rejects(linkShipment(s2.container, r2.id, "abc", "user_1"), refusal("bad_id"))
})

test("a canceled fulfillment cancels a row not sent; a sent one is flagged and left to a person", async () => {
  const s = setup(LIVE, [lockerOrder()])
  const row = await recorded(s)
  const canceled = await onFulfillmentCanceled(s.container, FUL)
  assert.equal(canceled?.state, "canceled")
  const s2 = setup(LIVE, [lockerOrder()])
  const r2 = await recorded(s2)
  await arm(s2, "shipment")
  const { plan } = await planForParcel(s2.container, r2.id)
  await createShipment(s2.container, r2.id, { actor: "user_1", trigger: "manual", planHash: plan.hash })
  const flagged = await onFulfillmentCanceled(s2.container, FUL)
  assert.equal(flagged?.state, "created")
  assert.ok(flagged?.fulfillment_canceled_at)
  assert.equal(s2.fake.calls.filter((c) => c.method === "DELETE").length, 0, "never canceled in ShipX by itself")
  assert.equal(row.state, "pending")
})

test("automatic mode: armed + autoCreate creates on the fulfillment; the status pass reads open shipments and orders pickups", async () => {
  const sender = { companyName: "Koda Supply", email: "sklep@example.com", phone: "000000002", street: "ul. Magazynowa", buildingNumber: "1", city: "Warszawa", postCode: "00-001" }
  const s = setup({ ...LIVE, autoCreate: true, sendingMethod: { courier: "dispatch_order" }, sender }, [withFulfillment(order(), { inpost_option: "inpost-kurier", type: "kurier", cod: false }, FUL)])
  await arm(s, "shipment")
  const row = await recorded(s)
  await settle()
  const created = s.parcels.rows[0]
  assert.equal(created.state, "created", `auto create (row ${row.id})`)
  assert.equal(created.sending_method, "dispatch_order")
  s.fake.set(String(created.shipment_id), "confirmed", { tracking_number: "8".repeat(24) })
  const stats = await runSync(s.container, "manual")
  assert.ok(stats)
  assert.equal(stats?.read, 1)
  assert.equal(stats?.pickups, 1)
  assert.equal(s.parcels.rows[0].dispatch_state, "requested")
  assert.equal(s.parcels.rows[0].dispatch_order_id, "77")
  const again = await requestPickup(s.container, null, "user_1")
  assert.equal(again.parcels, 0, "a shipment is never in two pickups")
})

test("the status pass skips everything while InPost is not configured, and records its run", async () => {
  const s = setup({ demo: false }, [])
  const stats = await runSync(s.container, "schedule")
  assert.equal(stats?.skipped, "not_configured")
  const live = setup(LIVE, [])
  await runSync(live.container, "schedule")
  assert.equal(live.events.rows.filter((e) => e.kind === "run").length, 1)
})

test("the status pass picks open shipments in the database: 400 delivered parcels never starve the one still on its way", async () => {
  const s = setup(LIVE, [])
  const base = { demo: false, option_id: "paczkomat", kind: "locker", cod: false, service: "inpost_locker_standard", locker_code: "KSP01M", parcel_size: "small", currency: "PLN", external: false, attempts: 0, state: "created" }
  const old = new Date(Date.now() - 3 * 3600 * 1000)
  for (let i = 0; i < 400; i++) {
    s.parcels.insert({ ...base, order_id: `order_done_${i}`, fulfillment_id: `ful_done_${i}`, parcel_no: 1, status: "delivered", shipment_id: String(1000 + i), shipment_created_at: old, last_checked_at: new Date(Date.now() - 10 * 24 * 3600 * 1000) })
  }
  s.parcels.insert({ ...base, order_id: "order_open", fulfillment_id: "ful_open", parcel_no: 1, status: "dispatched_by_sender", shipment_id: "5000", shipment_created_at: old, last_checked_at: old })
  s.fake.shipments.set("5000", { id: 5000, status: "out_for_delivery", tracking_number: "9".repeat(24), service: "inpost_locker_standard", reference: "1042-1" })
  const stats = await runSync(s.container, "schedule")
  assert.equal(stats?.read, 1)
  assert.equal(s.parcels.rows.find((r) => r.shipment_id === "5000")?.status, "out_for_delivery")
})

test("autoCreate never takes a backlog: only rows recorded after arming and within autoCreateMaxAgeHours", async () => {
  const s = setup({ ...LIVE, autoCreate: true, autoCreateMaxAgeHours: 48 }, [withFulfillment(order(), { inpost_option: "inpost-paczkomat", type: "paczkomat", cod: false, machine_id: "KSP01M" }, FUL)])
  const base = { demo: false, option_id: "paczkomat", kind: "locker", cod: false, service: "inpost_locker_standard", locker_code: "KSP01M", parcel_size: "small", currency: "PLN", external: false, attempts: 0, state: "pending", problems: null }
  s.parcels.insert({ ...base, order_id: order().id, fulfillment_id: "ful_old", parcel_no: 1, created_at: new Date(Date.now() - 5 * 24 * 3600 * 1000) })
  await arm(s, "shipment")
  const stats = await runSync(s.container, "schedule")
  assert.equal(stats?.created, 0)
  assert.equal(s.parcels.rows.find((r) => r.fulfillment_id === "ful_old")?.state, "pending")
  assert.equal(s.fake.calls.filter((c) => c.method === "POST").length, 0, "no shipment for a row older than the arming")
})
