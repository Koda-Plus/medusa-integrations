import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/negotiations/lib/options.ts"
import { readWriterSetting, writerSettingKey, writerState } from "../src/modules/negotiations/lib/writers.ts"
import { cartSnapshot, pickListPrice, threadTitle } from "../src/modules/negotiations/lib/catalog.ts"
import { createRateLimiter } from "../src/modules/negotiations/lib/rate-limit.ts"

test("defaults: live, 14 days, net prices, Store API on, customers may accept, every writer off", () => {
  const o = resolveOptions(undefined)
  assert.equal(o.demo, false)
  assert.equal(o.expiryDays, 14)
  assert.equal(o.defaultCurrency, null)
  assert.equal(o.taxInclusive, false)
  assert.equal(o.storeApi, true)
  assert.equal(o.customerAccept, true)
  assert.equal(o.maxMessageLength, 2000)
  assert.equal(o.maxQuantity, 100_000)
  assert.equal(o.maxActivePerCustomer, 20)
  assert.equal(o.openPerHour, 10)
  assert.equal(o.messagesPerHour, 60)
  assert.deepEqual(o.writers, { draftOrders: false })
  assert.deepEqual(o.draftOrders, { regionId: null, salesChannelId: null, maxPerRun: 10 })
})

test("values from environment strings; nonsense falls back instead of breaking the boot", () => {
  const o = resolveOptions({
    demo: "true",
    expiryDays: "30",
    defaultCurrency: "EUR",
    taxInclusive: "yes",
    storeApi: "off",
    maxMessageLength: "50",
    maxQuantity: "x",
    openPerHour: -3,
    writers: { draftOrders: "false" },
    draftOrders: { regionId: "reg_01J", salesChannelId: "not an id", maxPerRun: "500" },
    references: [{ name: "Shop", url: "http://insecure.example" }, { name: "Shop", url: "https://shop.example.com" }],
  })
  assert.equal(o.demo, true)
  assert.equal(o.expiryDays, 30)
  assert.equal(o.defaultCurrency, "eur")
  assert.equal(o.taxInclusive, true)
  assert.equal(o.storeApi, false)
  assert.equal(o.maxMessageLength, 200, "clamped to the minimum")
  assert.equal(o.maxQuantity, 100_000)
  assert.equal(o.openPerHour, 1)
  assert.deepEqual(o.writers, { draftOrders: false }, "an explicit false wins even in demo mode")
  assert.deepEqual(o.draftOrders, { regionId: "reg_01J", salesChannelId: null, maxPerRun: 100 })
  assert.equal("references" in o, false, "the old references option is ignored")
  assert.equal(resolveOptions({ expiryDays: 0 }).expiryDays, 0, "0 turns expiry off")
  assert.equal(resolveOptions({ expiryDays: 9999 }).expiryDays, 365)
})

test("writers: allowed by the option (or demo mode), armed only when a person turns them on too", () => {
  assert.deepEqual(resolveOptions({ demo: true }).writers, { draftOrders: true }, "demo mode allows: it only simulates")
  assert.deepEqual(resolveOptions({ writers: { draftOrders: true } }).writers, { draftOrders: true })
  assert.equal(writerSettingKey("draftOrders", true), "demo:writer:draftOrders")
  assert.equal(writerSettingKey("draftOrders", false), "live:writer:draftOrders")
  const at = new Date("2026-10-07T12:00:00Z")
  const on = readWriterSetting({ value: { on: true }, updated_by: "user_1", updated_at: at })
  assert.deepEqual(writerState("draftOrders", { draftOrders: true }, on), { key: "draftOrders", allowed: true, on: true, armed: true, updatedBy: "user_1", updatedAt: at.toISOString() })
  assert.equal(writerState("draftOrders", { draftOrders: false }, on).armed, false, "the option wins over the toggle")
  assert.equal(writerState("draftOrders", { draftOrders: true }, null).armed, false, "never armed by default")
  assert.equal(readWriterSetting({ value: { on: "yes" } })?.on, false, "only a real true arms")
})

test("list prices: base prices only, the quantity tier, prices without rules first", () => {
  const prices = [
    { amount: 549, currency_code: "pln" },
    { amount: 489, currency_code: "pln", min_quantity: 20 },
    { amount: 399, currency_code: "pln", price_list_id: "plist_1" },
    { amount: 120, currency_code: "eur" },
    { amount: 500, currency_code: "pln", rules_count: 1 },
    null,
  ]
  assert.equal(pickListPrice(prices, "pln", 1, 2), 54900)
  assert.equal(pickListPrice(prices, "pln", 24, 2), 48900)
  assert.equal(pickListPrice(prices, "eur", 1, 2), 12000)
  assert.equal(pickListPrice(prices, "usd", 1, 2), null)
  assert.equal(pickListPrice([{ amount: 500, currency_code: "pln", rules_count: 2 }], "pln", 1, 2), 50000, "a region price when there is nothing else")
  assert.equal(pickListPrice([{ amount: 10, currency_code: "pln", max_quantity: 5 }], "pln", 6, 2), null)
})

test("cart snapshots and titles", () => {
  const snap = cartSnapshot(
    [
      { variant_id: "v1", product_id: "p1", variant_sku: "A", product_title: "Drill", variant_title: "18V", quantity: 2, unit_price: 549 },
      { variant_id: "v2", title: "Screws", quantity: 10, unit_price: "42.90" },
      { variant_id: "v3", quantity: 0, unit_price: 5 },
      null,
    ],
    2,
  )
  assert.deepEqual(snap.lines.map((l) => [l.title, l.quantity, l.unit_amount]), [["Drill / 18V", 2, 54900], ["Screws", 10, 4290]])
  assert.equal(snap.total, 2 * 54900 + 10 * 4290)
  assert.equal(cartSnapshot([], 2).total, null)
  assert.equal(threadTitle("Drill", "Default variant"), "Drill")
  assert.equal(threadTitle("Drill", "Drill"), "Drill")
  assert.equal(threadTitle(null, "18V"), "18V")
  assert.equal(threadTitle("", ""), null)
})

test("the store rate limit: a sliding window per customer", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 })
  const t = 1_000_000
  assert.equal(limiter.hit("cus_1", t).ok, true)
  assert.equal(limiter.hit("cus_1", t + 1).ok, true)
  const third = limiter.hit("cus_1", t + 2)
  assert.equal(third.ok, false)
  assert.equal(third.retryAfterSeconds, 60)
  assert.equal(limiter.hit("cus_2", t + 2).ok, true, "per customer")
  assert.equal(limiter.hit("cus_1", t + 60_001).ok, true, "the window slides")
})
