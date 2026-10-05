import { test } from "node:test"
import assert from "node:assert/strict"
import {
  afterRejection,
  canArm,
  countPlan,
  dueItems,
  reconcilePlan,
  stableJson,
  toggleKey,
  writerSwitchState,
  type DesiredItem,
  type PlanRowLike,
} from "../src/modules/olx/lib/writers.ts"
import { planRow } from "./helpers.ts"

test("switches: the option wins, live mode needs a connected account with the write scope", () => {
  const armed = { armed: true, changedBy: "anna@shop.pl", changedAt: "2026-10-06T10:00:00Z" }
  assert.deepEqual(writerSwitchState({ allowedByConfig: true, toggle: armed, demo: false, connected: true, writeScope: true }), {
    allowedByConfig: true,
    armed: true,
    active: true,
    blockers: [],
  })
  const off = writerSwitchState({ allowedByConfig: false, toggle: armed, demo: false, connected: true, writeScope: true })
  assert.equal(off.active, false)
  assert.equal(off.armed, false, "a toggle armed before the option was turned off counts as not armed")
  assert.deepEqual(off.blockers, ["config_off", "not_armed"])
  assert.deepEqual(writerSwitchState({ allowedByConfig: true, toggle: armed, demo: false, connected: true, writeScope: false }).blockers, ["no_write_scope"])
  assert.deepEqual(writerSwitchState({ allowedByConfig: true, toggle: null, demo: true, connected: false, writeScope: false }).blockers, ["not_armed"])
  assert.equal(writerSwitchState({ allowedByConfig: true, toggle: armed, demo: true, connected: false, writeScope: false }).active, true)

  assert.deepEqual(canArm({ allowedByConfig: false, demo: true, connected: true, writeScope: true }), { ok: false, code: "config_off" })
  assert.deepEqual(canArm({ allowedByConfig: true, demo: false, connected: false, writeScope: false }), { ok: false, code: "not_connected" })
  assert.deepEqual(canArm({ allowedByConfig: true, demo: false, connected: true, writeScope: false }), { ok: false, code: "no_write_scope" })
  assert.deepEqual(canArm({ allowedByConfig: true, demo: true, connected: false, writeScope: false }), { ok: true })
  assert.notEqual(toggleKey("price", true), toggleKey("price", false), "demo toggles never arm a real account")
})

const want = (olxId: string, over: Partial<DesiredItem> = {}): DesiredItem => ({
  olxId,
  action: "deactivate",
  reason: "sold_out",
  from: "active",
  to: "removed_by_user",
  held: false,
  variantId: "variant_1",
  productId: "prod_1",
  sku: "SKU-1",
  title: "Advert",
  ...over,
})

const now = new Date("2026-10-06T12:00:00Z")

test("plan merge: new rows, in-flight rows untouched, quarantine kept for the same action", () => {
  const rows = [
    planRow({ olx_id: "2", state: "applying" }),
    planRow({ olx_id: "3", state: "unknown" }),
    planRow({ olx_id: "4", state: "quarantined", attempts: 3 }),
    planRow({ olx_id: "5", state: "pending", attempts: 0 }),
  ] as unknown as PlanRowLike[]
  const { creates, updates } = reconcilePlan(rows, [want("1"), want("2"), want("3"), want("4"), want("5")], { now })
  assert.deepEqual(creates.map((c) => [c.olx_id, c.state, c.attempts]), [["1", "pending", 0]])
  assert.deepEqual(updates, [], "nothing changed for 2 to 5")
})

test("plan merge: a new action or target starts over, a vanished need goes idle and clears quarantine", () => {
  const rows = [
    planRow({ olx_id: "6", state: "failed", attempts: 2, action: "deactivate" }),
    planRow({ olx_id: "7", state: "pending", writer: "price", action: "price", from_value: { value: 100, currency: "PLN" }, to_value: { value: 110, currency: "PLN" } }),
    planRow({ olx_id: "8", state: "quarantined", attempts: 3 }),
    planRow({ olx_id: "9", state: "done" }),
  ] as unknown as PlanRowLike[]
  const { creates, updates } = reconcilePlan(
    rows,
    [
      want("6", { action: "activate", reason: "back_in_stock", from: "removed_by_user", to: "active" }),
      want("7", { action: "price", reason: "price_changed", from: { value: 100, currency: "PLN" }, to: { value: 120, currency: "PLN" } }),
    ],
    { now },
  )
  assert.equal(creates.length, 0)
  const byId = new Map(updates.map((u) => [u.id, u.patch]))
  assert.equal(byId.get("olxpi_6")?.action, "activate")
  assert.equal(byId.get("olxpi_6")?.attempts, 0)
  assert.equal(byId.get("olxpi_6")?.state, "pending")
  assert.deepEqual(byId.get("olxpi_7")?.to_value, { value: 120, currency: "PLN" })
  assert.equal(byId.get("olxpi_7")?.attempts, 0)
  assert.equal(byId.get("olxpi_8")?.state, "idle", "the need is gone, so is the quarantine")
  assert.equal(byId.has("olxpi_9"), false, "history stays")
})

test("plan merge: held until a person approves exactly that value", () => {
  const big = want("10", { action: "price", reason: "price_changed", from: { value: 100, currency: "PLN" }, to: { value: 300, currency: "PLN" }, held: true })
  const first = reconcilePlan([], [big], { now })
  assert.equal(first.creates[0].state, "held")
  const approved = planRow({ olx_id: "10", writer: "price", action: "price", state: "held", to_value: { currency: "PLN", value: 300 }, approved_value: { value: 300, currency: "PLN" } })
  const second = reconcilePlan([approved] as unknown as PlanRowLike[], [big], { now })
  assert.equal(second.updates[0]?.patch.state, "pending", "approval survives the jsonb key order")
  const other = reconcilePlan([approved] as unknown as PlanRowLike[], [{ ...big, to: { value: 320, currency: "PLN" } }], { now })
  assert.equal(other.updates[0]?.patch.state, "held", "a new value needs a new approval")
})

test("plan merge: a paused advert live again forgets the pause", () => {
  const rows = [planRow({ olx_id: "11", state: "done", paused_at: new Date("2026-10-01T00:00:00Z") })] as unknown as PlanRowLike[]
  const { updates } = reconcilePlan(rows, [], { now, resumed: new Set(["11"]) })
  assert.deepEqual(updates, [{ id: "olxpi_11", patch: { paused_at: null } }])
})

test("due rows: open and under the attempt limit, endings first, held endings skipped", () => {
  const rows = [
    planRow({ olx_id: "1", action: "activate", state: "pending" }),
    planRow({ olx_id: "2", action: "deactivate", state: "failed", attempts: 2 }),
    planRow({ olx_id: "3", action: "deactivate", state: "failed", attempts: 3 }),
    planRow({ olx_id: "4", action: "finish", state: "pending" }),
    planRow({ olx_id: "5", action: "deactivate", state: "held" }),
    planRow({ olx_id: "6", action: "deactivate", state: "done" }),
  ]
  assert.deepEqual(dueItems(rows as never[], 10).map((r: { olx_id: string }) => r.olx_id), ["2", "4", "1"])
  assert.deepEqual(dueItems(rows as never[], 1).map((r: { olx_id: string }) => r.olx_id), ["2"])
  assert.deepEqual(dueItems(rows as never[], 10, { holdEndings: true }).map((r: { olx_id: string }) => r.olx_id), ["1"])
  assert.deepEqual(afterRejection(0), { state: "failed", attempts: 1 })
  assert.deepEqual(afterRejection(2), { state: "quarantined", attempts: 3 })
  assert.deepEqual(countPlan(rows), { pending: 2, held: 1, failed: 2, quarantined: 0, unknown: 0, applying: 0, done: 1 })
})

test("stable JSON ignores key order at every level", () => {
  assert.equal(stableJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), stableJson({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }))
  assert.notEqual(stableJson({ a: 1 }), stableJson({ a: 2 }))
})
