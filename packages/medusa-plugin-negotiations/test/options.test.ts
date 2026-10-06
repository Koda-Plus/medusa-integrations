import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/negotiations/lib/options.ts"
import { normalizeReferences, normalizeReview, pickText } from "../src/modules/negotiations/lib/references.ts"
import { toReferenceDto } from "../src/modules/negotiations/lib/dto.ts"
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
  assert.deepEqual(o.references, [], "the package names no store")
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
  assert.deepEqual(o.references.map((r) => r.url), ["https://shop.example.com/"], "https only")
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

test("references: entries without a name or an https URL are dropped, parts are cleaned, nothing throws", () => {
  const refs = normalizeReferences([
    {
      name: "Hurtownia Test",
      url: "https://www.hurtownia.example.com",
      description: { en: "Tools wholesale", pl: "Hurtownia narzędzi" },
      metrics: [{ label: { en: "threads a month", pl: "wątków miesięcznie" }, value: "120" }, { label: "broken" }],
      links: [{ label: "Product", url: "https://www.hurtownia.example.com/p/1" }, { label: "Insecure", url: "http://x.pl" }],
    },
    { name: "No URL" },
    { name: "Plain http", url: "http://shop.pl" },
    { name: "", url: "https://shop.pl" },
    { name: "Duplicate", url: "https://www.hurtownia.example.com" },
    "not an object",
    { name: "Same text", url: "https://shop.example.com", description: "Same in both" },
  ])
  assert.equal(refs.length, 2)
  assert.equal(refs[0].soon, false)
  assert.equal(refs[0].metrics.length, 1)
  assert.equal(refs[0].links.length, 1)
  assert.deepEqual(refs[1].description, { en: "Same in both", pl: "Same in both" })
  assert.deepEqual(normalizeReferences("nope"), [])
  assert.deepEqual(normalizeReferences(undefined), [])
  assert.equal(resolveOptions({ references: [{ name: "A", url: "https://a.pl" }] }).references.length, 1)
})

test("references: a review needs a positive rating and a source, never exceeds its scale, links only over https", () => {
  const review = normalizeReview({ rating: "4,8", source: "Clutch", url: "https://clutch.co/review/1", icon: "javascript:alert(1)", quote: { pl: "Polecam" } })
  assert.deepEqual(review, { rating: 4.8, scale: 5, source: "Clutch", url: "https://clutch.co/review/1", icon: null, quote: { pl: "Polecam" }, author: null })
  assert.equal(normalizeReview({ rating: 9, source: "Clutch" })?.rating, 5)
  assert.equal(normalizeReview({ rating: 9, scale: 10, source: "Google" })?.scale, 10)
  assert.equal(normalizeReview({ rating: 5, source: "Clutch", url: "http://clutch.co" })?.url, null)
  assert.equal(normalizeReview({ rating: 0, source: "Clutch" }), null)
  assert.equal(normalizeReview({ rating: 5 }), null)
  assert.equal(normalizeReview("5 stars"), null)
  const [withReview, without] = normalizeReferences([
    { name: "A", url: "https://a.pl", review: { rating: 5, source: "Clutch" } },
    { name: "B", url: "https://b.pl", review: { rating: "great" } },
  ])
  assert.equal(withReview.review?.rating, 5)
  assert.equal(without.review, null)
})

test("references: the admin language with a fallback to the other one", () => {
  assert.equal(pickText({ en: "Tools", pl: "Narzędzia" }, "pl"), "Narzędzia")
  assert.equal(pickText({ en: "Tools", pl: "Narzędzia" }, "en-US"), "Tools")
  assert.equal(pickText({ en: "Only English" }, "pl"), "Only English")
  assert.equal(pickText({ pl: "Tylko polski" }, "en"), "Tylko polski")
  assert.equal(pickText(null, "pl"), "")
})

test("references: a store that starts soon needs only its name, a live one still needs an https URL", () => {
  const refs = normalizeReferences([
    { name: "Soon, no address", soon: true, description: "Opens in spring" },
    { name: "Soon, with an address", soon: true, url: "https://soon.example.com" },
    { name: "Soon, insecure address", soon: true, url: "http://soon.example.com" },
    { name: "Live, no address" },
    { name: "Live, insecure address", url: "http://live.example.com" },
    { name: "Not a boolean", soon: "yes" },
    { soon: true },
  ])
  assert.deepEqual(
    refs.map((r) => ({ name: r.name, soon: r.soon, url: r.url })),
    [
      { name: "Soon, no address", soon: true, url: null },
      { name: "Soon, with an address", soon: true, url: "https://soon.example.com/" },
      { name: "Soon, insecure address", soon: true, url: null },
    ],
  )
  assert.deepEqual(refs[0].description, { en: "Opens in spring", pl: "Opens in spring" })
  assert.equal(normalizeReferences(Array.from({ length: 15 }, (_, i) => ({ name: `Store ${i}`, soon: true }))).length, 12)
  assert.deepEqual(resolveOptions({ references: [{ name: "Soon", soon: true }] }).references.map((r) => r.soon), [true])
  const dto = toReferenceDto(refs[0])
  assert.deepEqual([dto.name, dto.url, dto.soon], ["Soon, no address", null, true], "the admin gets the flag and no address")
})

test("references: the since date of an older config is ignored, never an error", () => {
  const refs = normalizeReferences([
    { name: "Live", url: "https://a.pl", since: "2026-04" },
    { name: "Soon", soon: true, since: { not: "a month" } },
  ])
  assert.equal(refs.length, 2)
  for (const r of refs) assert.equal("since" in r, false)
  assert.equal(refs[0].url, "https://a.pl/")
  assert.equal(refs[1].soon, true)
  for (const r of refs) assert.equal("since" in toReferenceDto(r), false)
})
