import { test } from "node:test"
import assert from "node:assert/strict"
import { amountString, boundValue, planPrices, recheckPrice, toCents, type PricePlanOffer } from "../src/modules/allegro/lib/price-plan.ts"
import { commandVerdict, endCommandBody, groupForCommands, parseReport, parseTasks, priceCommandBody, quantityCommandBody } from "../src/modules/allegro/lib/commands.ts"

const offer = (id: string, price: number, status = "ACTIVE"): PricePlanOffer => ({
  allegroId: id,
  name: `Offer ${id}`,
  status,
  price: { value: price, currency: "PLN" },
  variantId: `v${id}`,
  sku: `SKU-${id}`,
  productId: `p${id}`,
  productTitle: `Product ${id}`,
  isPrimary: true,
})

const prices = (entries: Array<[string, number]>) => new Map(entries.map(([id, v]) => [id, new Map([["PLN", v]])]))

test("price plan: inside the bounds the Medusa price becomes the Allegro price", () => {
  const plan = planPrices({
    offers: [offer("1", 109.99), offer("2", 89), offer("3", 50)],
    medusa: prices([
      ["v1", 99.99],
      ["v2", 95.5],
      ["v3", 50],
    ]),
    bounds: new Map([
      ["v1", { min: 80, max: 120 }],
      ["v2", { min: 80, max: null }],
      ["v3", { min: 40, max: 60 }],
    ]),
    requireFloor: true,
    maxChangePercent: 30,
    cap: 10,
    quarantined: new Set(),
  })
  const by = new Map(plan.entries.map((e) => [e.allegroId, e]))
  assert.deepEqual([by.get("1")?.reason, by.get("1")?.target], ["price_down", { amount: "99.99", currency: "PLN" }])
  assert.equal(by.get("2")?.reason, "price_up")
  assert.equal(by.get("3")?.status, "in_sync")
  assert.deepEqual(plan.counts, { down: 1, up: 1, skipped: 0, inSync: 1, quarantined: 0, deferred: 0 })
})

test("price plan: outside the bounds is refused, never clamped; no floor, no change", () => {
  const plan = planPrices({
    offers: [offer("1", 100), offer("2", 100), offer("3", 100), offer("4", 100)],
    medusa: prices([
      ["v1", 70],
      ["v2", 130],
      ["v3", 110],
      ["v4", 101],
    ]),
    bounds: new Map([
      ["v1", { min: 80, max: 150 }],
      ["v2", { min: 80, max: 120 }],
      ["v3", { min: null, max: null }],
      ["v4", { min: 120, max: 90 }],
    ]),
    requireFloor: true,
    maxChangePercent: 50,
    cap: 10,
    quarantined: new Set(),
  })
  assert.deepEqual(
    plan.entries.map((e) => e.reason),
    ["below_floor", "above_ceiling", "no_floor", "bad_bounds"],
  )
  assert.ok(plan.entries.every((e) => e.status === "skipped"))
})

test("price plan: a change bigger than maxChangePercent is a typo guard", () => {
  const plan = planPrices({
    offers: [offer("1", 100)],
    medusa: prices([["v1", 10]]),
    bounds: new Map([["v1", { min: 5, max: null }]]),
    requireFloor: true,
    maxChangePercent: 30,
    cap: 10,
    quarantined: new Set(),
  })
  assert.equal(plan.entries[0].reason, "change_too_big")
})

test("price plan: no price in the offer currency, offers not live, cap and quarantine", () => {
  const eur = new Map([["v1", new Map([["EUR", 20]])]])
  const none = planPrices({ offers: [offer("1", 100)], medusa: eur, bounds: new Map(), requireFloor: false, maxChangePercent: 30, cap: 10, quarantined: new Set() })
  assert.equal(none.entries[0].reason, "no_price")
  const ended = planPrices({ offers: [offer("1", 100, "ENDED")], medusa: prices([["v1", 90]]), bounds: new Map(), requireFloor: false, maxChangePercent: 30, cap: 10, quarantined: new Set() })
  assert.equal(ended.entries[0].reason, "not_live")
  const capped = planPrices({
    offers: [offer("1", 100), offer("2", 100), offer("3", 100)],
    medusa: prices([
      ["v1", 90],
      ["v2", 110],
      ["v3", 95],
    ]),
    bounds: new Map(),
    requireFloor: false,
    maxChangePercent: 30,
    cap: 1,
    quarantined: new Set(["3"]),
  })
  const by = new Map(capped.entries.map((e) => [e.allegroId, e.status]))
  /* A price below the store price goes first: selling under the store price costs money. */
  assert.equal(by.get("2"), "planned")
  assert.equal(by.get("1"), "deferred")
  assert.equal(by.get("3"), "quarantined")
})

test("money: grosze for comparisons, two decimals for Allegro, metadata bounds parsed strictly", () => {
  assert.equal(toCents(233.21), 23321)
  assert.equal(amountString(23321), "233.21")
  assert.equal(amountString(500), "5.00")
  assert.equal(boundValue("99,90"), 99.9)
  assert.equal(boundValue(" 120 "), 120)
  assert.equal(boundValue("365,31 zł"), null)
  assert.equal(boundValue(0), null)
  assert.equal(boundValue({}), null)
})

test("recheck price: only a live offer whose price still differs from the target", () => {
  const target = { amount: "99.99", currency: "PLN" }
  assert.equal(recheckPrice(target, { status: "ACTIVE", price: { value: 109.99, currency: "PLN" } }), true)
  assert.equal(recheckPrice(target, { status: "ACTIVE", price: { value: 99.99, currency: "PLN" } }), false)
  assert.equal(recheckPrice(target, { status: "ENDED", price: { value: 109.99, currency: "PLN" } }), false)
  assert.equal(recheckPrice(target, { status: "ACTIVE", price: { value: 109.99, currency: "EUR" } }), false)
  assert.equal(recheckPrice(target, null), false)
})

test("commands: one command per target value, at most the limit of offers each", () => {
  const items = [
    { offerId: "1", key: "3" },
    { offerId: "2", key: "3" },
    { offerId: "3", key: "end" },
    { offerId: "4", key: "3" },
    { offerId: "2", key: "3" },
  ]
  const groups = groupForCommands(items, 2)
  assert.deepEqual(groups, [
    { key: "3", offerIds: ["1", "2"] },
    { key: "3", offerIds: ["4"] },
    { key: "end", offerIds: ["3"] },
  ])
  assert.deepEqual(quantityCommandBody(3, ["1"]), { modification: { changeType: "FIXED", value: 3 }, offerCriteria: [{ type: "CONTAINS_OFFERS", offers: [{ id: "1" }] }] })
  assert.deepEqual(endCommandBody(["1"]).publication, { action: "END" })
  assert.deepEqual(priceCommandBody("9.99", "PLN", ["1"]).modification, { type: "FIXED_PRICE", price: { amount: "9.99", currency: "PLN" } })
})

test("commands: a report is done when completed or when every task is counted", () => {
  assert.equal(parseReport({ completedAt: "2026-10-06T10:00:00Z", taskCount: { total: 2, success: 1, failed: 0 } }).done, true)
  assert.equal(parseReport({ completedAt: null, taskCount: { total: 2, success: 1, failed: 1 } }).done, true)
  assert.equal(parseReport({ completedAt: null, taskCount: { total: 2, success: 1, failed: 0 } }).done, false)
  assert.equal(parseReport(null).done, false)
})

test("commands: tasks name the offer, the status and the first error; the verdict separates item from systemic", () => {
  const tasks = parseTasks({
    tasks: [
      { offer: { id: "1" }, status: "SUCCESS" },
      { offer: { id: "2" }, status: "FAIL", message: "The offer cannot be changed", errors: [{ userMessage: "Oferta zakończona" }] },
      { offer: { id: "3" }, status: "NEW" },
      { status: "SUCCESS" },
    ],
  })
  assert.equal(tasks.length, 3)
  assert.equal(tasks[1].message, "The offer cannot be changed: Oferta zakończona")
  assert.equal(commandVerdict(tasks), "partial")
  assert.equal(commandVerdict([{ offerId: "1", status: "FAIL", message: null }]), "all_failed")
  assert.equal(commandVerdict([{ offerId: "1", status: "SUCCESS", message: null }, { offerId: "2", status: "NEW", message: null }]), "pending")
  assert.equal(commandVerdict([]), "pending")
})
