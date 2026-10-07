/**
 * Demo mode: sample shipments built once from the store's own orders,
 * deterministic, flagged and never mixed with real ones, nothing sent to
 * InPost; the simulation of a shipment a person creates; the reset.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { DEMO_SEED_ACTOR, demoNextStatus, demoRows, demoShipmentId, demoStatusAfter, demoTrackingNumber } from "../src/modules/inpost/lib/demo.ts"
import { ensureDemoSeed, resetDemo } from "../src/workflows/inpost/demo.ts"
import { buyOffer, cancelShipment, createShipment, labelOf, planForParcel, refreshParcel } from "../src/workflows/inpost/parcels.ts"
import { runSync } from "../src/workflows/inpost/sync.ts"
import { arm, order, setup } from "./helpers.ts"

const orders = (n: number, currency = "pln") =>
  Array.from({ length: n }, (_, i) => order({ id: `order_DEMO${String(i).padStart(4, "0")}`, display_id: 2000 + i, currency_code: currency, total: 100 + i, created_at: new Date(Date.UTC(2026, 9, 1, 8, i)).toISOString() }))

test("the same orders give the same rows: one scenario per order, every Panel list filled", () => {
  const now = new Date("2026-10-07T12:00:00Z")
  const a = demoRows(orders(16), now)
  const b = demoRows(orders(16), now)
  assert.deepEqual(a, b)
  assert.equal(a.length, 16)
  assert.ok(a.every((r) => r.demo === true && r.created_by === DEMO_SEED_ACTOR))
  const states = new Set(a.map((r) => `${r.state}:${r.status ?? ""}`))
  for (const want of ["pending:", "created:confirmed", "created:offers_prepared", "created:ready_to_pickup", "created:delivered", "created:pickup_time_expired", "created:returned_to_sender", "skipped:"]) assert.ok(states.has(want), want)
  assert.ok(a.every((r) => !r.locker_code || r.locker_code.startsWith("KSP")), "invented lockers only")
  assert.ok(a.filter((r) => r.tracking_number).every((r) => r.tracking_number?.startsWith("99") && r.tracking_number.length === 24))
  assert.equal(demoShipmentId("x"), demoShipmentId("x"))
  assert.match(demoShipmentId("x"), /^9\d{11}$/)
  assert.match(demoTrackingNumber("x"), /^99\d{22}$/)
})

test("an order not in PLN gets the scenario without cash on delivery; fewer orders, fewer rows", () => {
  const rows = demoRows(orders(3, "eur"), new Date())
  assert.equal(rows.length, 3)
  assert.ok(rows.every((r) => r.cod === false))
  const pln = demoRows(orders(1), new Date())[0]
  assert.equal(pln.cod, true)
  assert.equal(pln.option_id, "inpost-paczkomat-cod")
})

test("the simulated timeline: forward only, seeded rows and problems never move", () => {
  assert.equal(demoStatusAfter("locker", 0), "created")
  assert.equal(demoStatusAfter("locker", 2), "confirmed")
  assert.equal(demoStatusAfter("locker", 130), "ready_to_pickup")
  assert.equal(demoStatusAfter("courier", 200), "delivered")
  const started = new Date("2026-10-07T10:00:00Z")
  const now = new Date("2026-10-07T12:01:00Z")
  assert.equal(demoNextStatus({ kind: "locker", status: "created", created_by: "user_1", shipment_created_at: started }, now), "ready_to_pickup")
  assert.equal(demoNextStatus({ kind: "locker", status: "created", created_by: DEMO_SEED_ACTOR, shipment_created_at: started }, now), null)
  assert.equal(demoNextStatus({ kind: "locker", status: "pickup_time_expired", created_by: "user_1", shipment_created_at: started }, now), null)
  assert.equal(demoNextStatus({ kind: "locker", status: "ready_to_pickup", created_by: "user_1", shipment_created_at: started }, now), null)
})

test("the seed: built once from the newest orders, with history; live rows never touched; nothing sent to InPost", async () => {
  const s = setup({}, orders(20))
  assert.equal(await ensureDemoSeed(s.container), 16)
  assert.equal(await ensureDemoSeed(s.container), 0)
  assert.equal(s.parcels.rows.length, 16)
  assert.equal(s.parcels.rows[0].order_id, "order_DEMO0019", "the newest order first")
  assert.ok(s.events.rows.length >= 16)
  assert.equal(s.fake.calls.length, 0)
  const live = setup({ apiToken: "x".repeat(40), organizationId: "1" }, orders(5))
  assert.equal(await ensureDemoSeed(live.container), 0)
  const empty = setup({}, [])
  assert.equal(await ensureDemoSeed(empty.container), 0)
  assert.equal(empty.settings.rows.length, 0, "no orders: nothing claimed, the next visit tries again")
})

test("a person in the demo: arm, read the plan, create, the label, the simulation moves on; buy and cancel too", async () => {
  const s = setup({}, orders(16))
  await ensureDemoSeed(s.container)
  await arm(s, "shipment", true)
  const pending = s.parcels.rows.find((r) => r.state === "pending" && r.locker_code)
  assert.ok(pending)
  const { plan } = await planForParcel(s.container, pending.id)
  assert.equal(plan.ok, true)
  assert.equal(plan.receiver.sample, false)
  const created = await createShipment(s.container, pending.id, { actor: "user_demo", trigger: "manual", planHash: plan.hash })
  assert.equal(created.state, "created")
  assert.match(String(created.shipment_id), /^9\d{11}$/)
  assert.equal(s.emitted[0].data.demo, true)
  s.parcels.rows.find((r) => r.id === pending.id).shipment_created_at = new Date(Date.now() - 3 * 60 * 1000)
  const moved = await refreshParcel(s.container, pending.id, "admin")
  assert.equal(moved.status, "confirmed")
  const label = await labelOf(s.container, pending.id, "A6")
  assert.ok(new TextDecoder().decode(label.data).startsWith("%PDF-1.4"))
  const offer = s.parcels.rows.find((r) => r.status === "offers_prepared")
  const bought = await buyOffer(s.container, offer.id, { actor: "user_demo", trigger: "manual" })
  assert.equal(bought.status, "confirmed")
  const second = s.parcels.rows.find((r) => r.state === "pending" && r.id !== pending.id && r.kind === "courier")
  const p2 = await planForParcel(s.container, second.id)
  await createShipment(s.container, second.id, { actor: "user_demo", trigger: "manual", planHash: p2.plan.hash })
  assert.equal((await cancelShipment(s.container, second.id, "user_demo")).state, "canceled")
  await runSync(s.container, "manual")
  assert.equal(s.fake.calls.length, 0, "demo mode never calls InPost")
})

test("reset: the demo starts over, toggles off, the sample rows back", async () => {
  const s = setup({}, orders(4))
  await ensureDemoSeed(s.container)
  await arm(s, "shipment", true)
  s.parcels.rows[0].state = "canceled"
  assert.equal(await resetDemo(s.container), 4)
  assert.equal(s.parcels.rows.length, 4)
  assert.equal(s.settings.rows.some((r) => r.key === "demo:writer:shipment"), false)
  assert.equal(s.parcels.rows[0].state, "pending")
})
