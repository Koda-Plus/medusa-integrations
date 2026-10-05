import { test } from "node:test"
import assert from "node:assert/strict"
import { planStock, raiseGuard, recheck, type StockPlanInput, type StockPlanOffer } from "../src/modules/allegro/lib/stock-plan.ts"

const offer = (id: string, status: string, available: number | null, variant = `v${id}`): StockPlanOffer => ({
  allegroId: id,
  name: `Offer ${id}`,
  status,
  available,
  variantId: variant,
  sku: `SKU-${id}`,
  productId: `p${id}`,
  productTitle: `Product ${id}`,
  isPrimary: true,
})

const base = (over: Partial<StockPlanInput> = {}): StockPlanInput => ({
  mode: "decrease",
  endAtZero: true,
  offers: [],
  medusa: new Map(),
  medusaComplete: true,
  raise: { allowed: false, reason: "not armed" },
  cap: 50,
  quarantined: new Set(),
  ...over,
})

test("stock plan: decrease to Medusa, end when Medusa sold out, nothing when equal", () => {
  const plan = planStock(
    base({
      offers: [offer("1", "ACTIVE", 5), offer("2", "ACTIVE", 3), offer("3", "ACTIVE", 4)],
      medusa: new Map([
        ["v1", 2],
        ["v2", 0],
        ["v3", 4],
      ]),
    }),
  )
  const by = new Map(plan.entries.map((e) => [e.allegroId, e]))
  assert.equal(plan.refused, null)
  assert.deepEqual([by.get("1")?.action, by.get("1")?.target, by.get("1")?.reason], ["decrease", 2, "oversell"])
  assert.deepEqual([by.get("2")?.action, by.get("2")?.target, by.get("2")?.reason], ["end", 0, "sold_out"])
  assert.equal(by.get("3")?.status, "in_sync")
  assert.deepEqual(plan.counts, { decrease: 1, increase: 0, end: 1, skipped: 0, inSync: 1, quarantined: 0, deferred: 0 })
})

test("stock plan: decrease mode never raises; ended offers and drafts are never touched", () => {
  const plan = planStock(
    base({
      offers: [offer("1", "ACTIVE", 1), offer("2", "ENDED", 0), offer("3", "INACTIVE", 0)],
      medusa: new Map([
        ["v1", 9],
        ["v2", 9],
        ["v3", 9],
      ]),
    }),
  )
  const by = new Map(plan.entries.map((e) => [e.allegroId, e]))
  assert.deepEqual([by.get("1")?.action, by.get("1")?.reason], ["none", "decrease_only"])
  assert.deepEqual([by.get("2")?.action, by.get("2")?.reason], ["none", "ended"])
  assert.deepEqual([by.get("3")?.action, by.get("3")?.reason], ["none", "draft"])
})

test("stock plan: mirror raises only while the order import keeps Medusa current", () => {
  const input = base({ mode: "mirror", offers: [offer("1", "ACTIVE", 1)], medusa: new Map([["v1", 6]]) })
  assert.equal(planStock(input).entries[0].reason, "raise_blocked")
  const allowed = planStock({ ...input, raise: { allowed: true, reason: null } })
  assert.deepEqual([allowed.entries[0].action, allowed.entries[0].target], ["increase", 6])
})

test("stock plan: untracked variants, unknown quantities and variants missing from the read are never guessed", () => {
  const plan = planStock(
    base({
      offers: [offer("1", "ACTIVE", 3), offer("2", "ACTIVE", null), offer("3", "ACTIVE", 3, "gone")],
      medusa: new Map<string, number | null>([
        ["v1", null],
        ["v2", 5],
      ]),
    }),
  )
  assert.deepEqual(
    plan.entries.map((e) => e.reason),
    ["untracked", "allegro_unknown", "no_variant"],
  )
  assert.ok(plan.entries.every((e) => e.action === "none"))
})

test("stock plan: Allegro cannot hold zero, so without endAtZero a sold-out offer is only reported", () => {
  const plan = planStock(base({ endAtZero: false, offers: [offer("1", "ACTIVE", 2)], medusa: new Map([["v1", 0]]) }))
  assert.deepEqual([plan.entries[0].action, plan.entries[0].reason], ["none", "zero_not_settable"])
})

test("stock plan: an incomplete Medusa read plans nothing", () => {
  const plan = planStock(base({ medusaComplete: false, offers: [offer("1", "ACTIVE", 5)], medusa: new Map([["v1", 1]]) }))
  assert.equal(plan.entries.length, 0)
  assert.match(plan.refused ?? "", /incomplete/)
})

test("stock plan: Medusa at zero for most variants looks like a broken read, not a sell-out", () => {
  const offers = Array.from({ length: 6 }, (_, i) => offer(String(i), "ACTIVE", 4))
  const medusa = new Map(offers.map((o, i) => [o.variantId as string, i === 0 ? 3 : 0]))
  const plan = planStock(base({ offers, medusa }))
  assert.equal(plan.entries.length, 0)
  assert.match(plan.refused ?? "", /stockLocationIds/)
})

test("stock plan: ending a large share of live offers is refused", () => {
  const offers = Array.from({ length: 12 }, (_, i) => offer(String(i), "ACTIVE", 2))
  /* Five zeros out of twelve: under the mass-zero guard, over the mass-end guard. */
  const medusa = new Map(offers.map((o, i) => [o.variantId as string, i < 5 ? 0 : 2]))
  const plan = planStock(base({ offers, medusa }))
  assert.match(plan.refused ?? "", /would end 5 of 12/)
})

test("stock plan: the cap defers the rest, most urgent first; quarantined lines wait for a person", () => {
  const plan = planStock(
    base({
      cap: 2,
      offers: [offer("a", "ACTIVE", 3), offer("b", "ACTIVE", 9), offer("c", "ACTIVE", 2), offer("d", "ACTIVE", 7)],
      medusa: new Map([
        ["va", 2],
        ["vb", 1],
        ["vc", 0],
        ["vd", 6],
      ]),
      quarantined: new Set(["d"]),
    }),
  )
  const by = new Map(plan.entries.map((e) => [e.allegroId, e.status]))
  /* The end first, then the biggest oversell (b: 9 against 1); a waits; d is quarantined. */
  assert.equal(by.get("c"), "planned")
  assert.equal(by.get("b"), "planned")
  assert.equal(by.get("a"), "deferred")
  assert.equal(by.get("d"), "quarantined")
})

test("recheck: right before the command, a decrease never becomes a raise", () => {
  assert.deepEqual(recheck({ action: "decrease", target: 2 }, { status: "ACTIVE", available: 5 }), { ok: true })
  assert.deepEqual(recheck({ action: "decrease", target: 2 }, { status: "ACTIVE", available: 1 }), { ok: false, reason: "changed" })
  assert.deepEqual(recheck({ action: "decrease", target: 2 }, { status: "ACTIVE", available: 2 }), { ok: false, reason: "already_done" })
  assert.deepEqual(recheck({ action: "decrease", target: 2 }, { status: "ENDED", available: 0 }), { ok: false, reason: "not_live" })
  assert.deepEqual(recheck({ action: "end", target: 0 }, { status: "ENDED", available: 0 }), { ok: false, reason: "already_done" })
  assert.deepEqual(recheck({ action: "end", target: 0 }, { status: "ACTIVE", available: 3 }), { ok: true })
  assert.deepEqual(recheck({ action: "increase", target: 6 }, { status: "ACTIVE", available: 7 }), { ok: false, reason: "changed" })
  assert.deepEqual(recheck({ action: "decrease", target: 2 }, null), { ok: false, reason: "gone" })
})

test("raise guard: armed import, a recent successful run and nothing held", () => {
  const now = new Date("2026-10-06T12:00:00Z")
  assert.equal(raiseGuard({ importArmed: false, lastImportOkAt: now, heldImports: 0, now }).allowed, false)
  assert.equal(raiseGuard({ importArmed: true, lastImportOkAt: new Date("2026-10-06T11:00:00Z"), heldImports: 0, now }).allowed, false)
  assert.equal(raiseGuard({ importArmed: true, lastImportOkAt: new Date("2026-10-06T11:55:00Z"), heldImports: 2, now }).allowed, false)
  assert.equal(raiseGuard({ importArmed: true, lastImportOkAt: new Date("2026-10-06T11:55:00Z"), heldImports: 0, now }).allowed, true)
})
