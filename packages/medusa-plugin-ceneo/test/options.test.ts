import { test } from "node:test"
import assert from "node:assert/strict"
import { feedGaps, resolveOptions } from "../src/modules/ceneo/lib/options.ts"

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2"
const URL = "https://shop.example.com/pl/products/{handle}?variant={variant_id}"

test("options: defaults when nothing is set, nothing ever throws", () => {
  for (const input of [undefined, null, {}, "nonsense", 42, { feed: "x", reviews: 7 }]) {
    const o = resolveOptions(input as never)
    assert.equal(o.demo, false)
    assert.equal(o.feed.token, null)
    assert.equal(o.feed.productUrl, null)
    assert.equal(o.feed.offerId, "variant_id")
    assert.equal(o.feed.inStockAvail, 1)
    assert.equal(o.feed.backorderAvail, 7)
    assert.equal(o.feed.outOfStock, "skip")
    assert.equal(o.feed.intervalMinutes, 30)
    assert.equal(o.reviews.accountGuid, null)
    assert.equal(o.apiKey, null)
    assert.equal(o.timeoutMs, 15_000)
  }
})

test("options: demo mode is only ever on with demo: true, never because a key is missing", () => {
  assert.equal(resolveOptions({ demo: true }).demo, true)
  assert.equal(resolveOptions({ demo: "true" }).demo, true)
  assert.equal(resolveOptions({ demo: "yes" }).demo, false)
  assert.equal(resolveOptions({ apiKey: "" }).demo, false)
})

test("options: a weak or malformed feed token keeps the feed off and says so", () => {
  assert.equal(resolveOptions({ feed: { token: TOKEN } }).feed.token, TOKEN)
  for (const bad of ["short", "has spaces in it 1234567", "x".repeat(129), "ąęśćżźółń1234567890"]) {
    const o = resolveOptions({ feed: { token: bad } })
    assert.equal(o.feed.token, null, bad)
    assert.equal(o.feed.tokenRejected, true, bad)
  }
  assert.equal(resolveOptions({ feed: { token: "  " } }).feed.tokenRejected, false)
})

test("options: the product URL must be http(s) with a placeholder that tells products apart", () => {
  assert.equal(resolveOptions({ feed: { productUrl: URL } }).feed.productUrl, URL)
  assert.equal(resolveOptions({ feed: { productUrl: "https://shop.example.com/p/{sku}" } }).feed.productUrl, "https://shop.example.com/p/{sku}")
  for (const bad of ["https://shop.example.com/products", "ftp://shop.example.com/{handle}", "{handle}"]) {
    const o = resolveOptions({ feed: { productUrl: bad } })
    assert.equal(o.feed.productUrl, null, bad)
    assert.equal(o.feed.productUrlRejected, true, bad)
  }
})

test("options: avail values outside the Ceneo list fall back, strings from env are read", () => {
  assert.equal(resolveOptions({ feed: { inStockAvail: 3, backorderAvail: "14" } }).feed.inStockAvail, 3)
  assert.equal(resolveOptions({ feed: { backorderAvail: "14" } }).feed.backorderAvail, 14)
  assert.equal(resolveOptions({ feed: { inStockAvail: 2 } }).feed.inStockAvail, 1)
  assert.equal(resolveOptions({ feed: { backorderAvail: "soon" } }).feed.backorderAvail, 7)
  assert.equal(resolveOptions({ feed: { outOfStock: "check" } }).feed.outOfStock, "check")
  assert.equal(resolveOptions({ feed: { outOfStock: "hide" } }).feed.outOfStock, "skip")
  assert.equal(resolveOptions({ feed: { offerId: "sku" } }).feed.offerId, "sku")
  assert.equal(resolveOptions({ feed: { offerId: "ean" } }).feed.offerId, "variant_id")
})

test("options: the build interval and timeout are bounded", () => {
  assert.equal(resolveOptions({ feed: { intervalMinutes: 1 } }).feed.intervalMinutes, 5)
  assert.equal(resolveOptions({ feed: { intervalMinutes: "60" } }).feed.intervalMinutes, 60)
  assert.equal(resolveOptions({ feed: { intervalMinutes: 99999 } }).feed.intervalMinutes, 1440)
  assert.equal(resolveOptions({ timeoutMs: 10 }).timeoutMs, 1000)
  assert.equal(resolveOptions({ timeoutMs: "nope" }).timeoutMs, 15_000)
})

test("options: the Zaufane Opinie GUID and survey delay", () => {
  const guid = "0F8FAD5B-D9CB-469F-A165-70867728950E"
  const o = resolveOptions({ reviews: { accountGuid: guid, workDays: "5" } })
  assert.equal(o.reviews.accountGuid, guid.toLowerCase())
  assert.equal(o.reviews.workDays, 5)
  assert.equal(resolveOptions({ reviews: { accountGuid: "not-a-guid" } }).reviews.accountGuidRejected, true)
  assert.equal(resolveOptions({ reviews: { workDays: 22 } }).reviews.workDays, null)
  assert.equal(resolveOptions({ reviews: { workDays: 2.5 } }).reviews.workDays, null)
  assert.equal(resolveOptions({ reviews: { workDays: 0 } }).reviews.workDays, 0)
})

test("feed gaps: what the feed still needs, in the order of the guide", () => {
  assert.deepEqual(feedGaps(resolveOptions({})), ["token", "product_url"])
  assert.deepEqual(feedGaps(resolveOptions({ feed: { token: "short", productUrl: "https://x.example.com" } })), ["token_rejected", "product_url_rejected"])
  assert.deepEqual(feedGaps(resolveOptions({ feed: { token: TOKEN, productUrl: URL } })), [])
})
