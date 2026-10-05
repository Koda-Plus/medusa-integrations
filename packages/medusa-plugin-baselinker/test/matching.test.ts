import { test } from "node:test"
import assert from "node:assert/strict"
import { matchCards, normalizeEan, normalizeSku, type CatalogVariant } from "../src/modules/baselinker/lib/matching.ts"

const v = (id: string, sku: string | null, codes: Array<string | null> = []): CatalogVariant => ({
  id,
  productId: `prod_${id}`,
  sku,
  codes,
  productTitle: `Product ${id}`,
})
const card = (blProductId: string, sku: string | null, ean: string | null = null) => ({ blProductId, sku, ean })

test("keys: SKU uppercased and trimmed, EAN digits only, 8 to 14", () => {
  assert.equal(normalizeSku("  wz-138 xd "), "WZ-138 XD")
  assert.equal(normalizeSku("   "), null)
  assert.equal(normalizeEan("590-1234 123457"), "5901234123457")
  assert.equal(normalizeEan("1234567"), null)
  assert.equal(normalizeEan("ABC12345678"), null)
})

test("SKU links case-insensitively, EAN is the fallback", () => {
  const { matches, summary } = matchCards(
    [card("1", "wz-138 xd"), card("2", "OTHER-SKU", "5901234123457"), card("3", "NOWHERE")],
    [v("a", "WZ-138 XD"), v("b", "B-1", ["590 1234 123457"])],
  )
  assert.equal(matches.get("1")?.variant?.id, "a")
  assert.equal(matches.get("1")?.source, "sku")
  assert.equal(matches.get("2")?.variant?.id, "b")
  assert.equal(matches.get("2")?.source, "ean")
  assert.equal(matches.get("3")?.variant, null)
  assert.equal(matches.get("3")?.conflict, null)
  assert.equal(summary.linkedBySku, 1)
  assert.equal(summary.linkedByEan, 1)
  assert.equal(summary.unmatched, 1)
})

test("one SKU on two cards: both reported, neither linked", () => {
  const { matches, summary } = matchCards([card("10", "A-1"), card("11", "a-1 "), card("12", "B-1")], [v("a", "A-1"), v("b", "B-1")])
  assert.equal(matches.get("10")?.conflict, "duplicate_sku")
  assert.equal(matches.get("11")?.conflict, "duplicate_sku")
  assert.equal(matches.get("10")?.variant, null)
  assert.equal(matches.get("12")?.variant?.id, "b")
  assert.equal(summary.duplicateSku, 2)
  assert.deepEqual(summary.duplicateSkus, ["A-1"])
  assert.equal(summary.onlyInMedusa, 0, "a duplicated SKU is a conflict, not a missing card")
})

test("one EAN on two cards is reported when the SKU did not settle it", () => {
  const { matches, summary } = matchCards([card("1", null, "5901234123457"), card("2", "X", "5901234123457")], [v("a", "A", ["5901234123457"])])
  assert.equal(matches.get("1")?.conflict, "duplicate_ean")
  assert.equal(matches.get("2")?.conflict, "duplicate_ean")
  assert.equal(summary.duplicateEan, 2)
  assert.equal(summary.linked, 0)
})

test("two Medusa variants on one key: ambiguous, never guessed", () => {
  const { matches } = matchCards(
    [card("1", "dup"), card("2", null, "5901234123457")],
    [v("a", "DUP"), v("b", "dup"), v("c", "C", ["5901234123457"]), v("d", "D", ["5901234123457"])],
  )
  assert.equal(matches.get("1")?.conflict, "ambiguous_variant")
  assert.equal(matches.get("2")?.conflict, "ambiguous_variant")
})

test("an EAN never takes a variant already linked by SKU", () => {
  const { matches } = matchCards([card("1", "A"), card("2", "COPY", "5901234123457")], [v("a", "A", ["5901234123457"])])
  assert.equal(matches.get("1")?.variant?.id, "a")
  assert.equal(matches.get("2")?.variant, null)
})

test("variants with a SKU that no card carries are counted as only in Medusa", () => {
  const { summary } = matchCards([card("1", "A"), card("2", null, "5901234123457")], [v("a", "A"), v("b", "B"), v("c", "C", ["5901234123457"]), v("d", null)])
  assert.equal(summary.onlyInMedusa, 1)
  assert.deepEqual(summary.onlyInMedusaSkus, ["B"])
  assert.equal(summary.noSku, 1)
})
