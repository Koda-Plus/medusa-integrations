/**
 * Tags by sign-up source and for buyers: the settings are cleaned before
 * they are used, a source adds its tags to the general ones without
 * duplicates, and an order plans buyer tags and product tags.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { effectiveSettings, idList, prefixOf, PRODUCT_TAG_PREFIX, sourceKey, sourceTagsOf, tagsForSource } from "../src/modules/kit/lib/store.ts"
import { planBuyerTags } from "../src/modules/kit/lib/order-tags.ts"
import { dayIso } from "../src/modules/kit/lib/insights.ts"

const options = { apiKey: "k", source: "Shop", doubleOptIn: false, formId: null, tags: [1], requestsPerMinute: 90, timeoutMs: 1000, storefrontUrl: null, problems: [] }

test("ids keep only positive integers", () => {
  assert.deepEqual(idList([3, "4", -1, 0, 2.5, "x"]), [3, 4])
  assert.deepEqual(idList("3"), [])
})

test("source keys are short, lower case and safe", () => {
  assert.equal(sourceKey(" Drop "), "drop")
  assert.equal(sourceKey("drop-boostera_2"), "drop-boostera_2")
  assert.equal(sourceKey("drop boostera"), null)
  assert.equal(sourceKey(""), null)
  assert.equal(sourceKey("x".repeat(41)), null)
})

test("the source map drops bad keys and empty tag lists", () => {
  assert.deepEqual(sourceTagsOf({ Drop: [5, "6"], "bad key": [1], empty: [] }), { drop: [5, 6] })
  assert.deepEqual(sourceTagsOf([1, 2]), {})
  assert.deepEqual(sourceTagsOf(null), {})
})

test("a sign-up from a source gets its extra tags once", () => {
  const settings = { tags: [1, 2], source_tags: { drop: [2, 9] } }
  assert.deepEqual(tagsForSource(settings, "drop"), [1, 2, 9])
  assert.deepEqual(tagsForSource(settings, "DROP"), [1, 2, 9])
  assert.deepEqual(tagsForSource(settings, "form"), [1, 2])
  assert.deepEqual(tagsForSource(settings, undefined), [1, 2])
})

test("settings in effect fill the new keys with safe defaults", () => {
  const s = effectiveSettings(options, null)
  assert.deepEqual(s.source_tags, {})
  assert.deepEqual(s.buyer_tags, [])
  assert.equal(s.product_tags, false)
  assert.equal(s.product_tag_prefix, PRODUCT_TAG_PREFIX)
  const t = effectiveSettings(options, { buyer_tags: [7], product_tags: true, product_tag_prefix: "Kupił: ", source_tags: { drop: [4] } })
  assert.deepEqual(t.buyer_tags, [7])
  assert.equal(t.product_tags, true)
  assert.equal(t.product_tag_prefix, "Kupił: ")
  assert.deepEqual(t.source_tags, { drop: [4] })
})

test("an empty prefix falls back to the default", () => {
  assert.equal(prefixOf("   "), PRODUCT_TAG_PREFIX)
  assert.equal(prefixOf(42), PRODUCT_TAG_PREFIX)
  assert.equal(prefixOf("x".repeat(60)).length, 40)
})

test("an order plans buyer tags and one tag per product title", () => {
  const plan = planBuyerTags({ buyer_tags: [3, 3], product_tags: true, product_tag_prefix: "Kupił: " }, ["Mentol", " Mentol ", "", "Booster"])
  assert.deepEqual(plan.tagIds, [3])
  assert.deepEqual(plan.productTagNames, ["Kupił: Mentol", "Kupił: Booster"])
  const off = planBuyerTags({ buyer_tags: [], product_tags: false, product_tag_prefix: "Kupił: " }, ["Mentol"])
  assert.deepEqual(off, { tagIds: [], productTagNames: [] })
})

test("days for the growth window are plain dates", () => {
  const now = new Date("2026-10-15T10:00:00Z")
  assert.equal(dayIso(0, now), "2026-10-15")
  assert.equal(dayIso(30, now), "2026-09-15")
})
