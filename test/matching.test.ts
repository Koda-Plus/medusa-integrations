import { test } from "node:test"
import assert from "node:assert/strict"
import { advertKey, betterAdvert, matchAdverts, statusGroup, type CatalogVariant } from "../src/modules/olx/lib/matching.ts"

const variants: CatalogVariant[] = [
  { id: "variant_1", sku: "KS-ELN-18V", productId: "prod_1", productTitle: "Wkrętarka 18V" },
  { id: "variant_2", sku: "wz-138 xd", productId: "prod_2", productTitle: "Felgi" },
  { id: "variant_3", sku: "KS-TSM-5M", productId: "prod_3", productTitle: "Taśma 5 m" },
]

const advert = (olxId: string, status: string, externalId: string | null, descriptionSku: string | null) => ({
  olxId,
  status,
  externalId,
  descriptionSku,
})

test("status groups: only active is live, limited is its own group", () => {
  assert.equal(statusGroup("active"), "live")
  assert.equal(statusGroup("limited"), "limited")
  for (const s of ["outdated", "removed_by_user", "moderated", "blocked", "new", "", null]) {
    assert.equal(statusGroup(s), "ended")
  }
})

test("key: external_id wins over the description, both uppercased", () => {
  assert.deepEqual(advertKey(advert("1", "active", " ks-eln-18v ", "OTHER")), { key: "KS-ELN-18V", source: "external_id" })
  assert.deepEqual(advertKey(advert("1", "active", null, "wz-138 xd")), { key: "WZ-138 XD", source: "description" })
  assert.equal(advertKey(advert("1", "active", "  ", null)), null)
})

test("ranking: live beats limited beats ended, then the higher id", () => {
  const ended = advert("900", "outdated", "A", null)
  const limited = advert("100", "limited", "A", null)
  const live = advert("50", "active", "A", null)
  assert.equal(betterAdvert(ended, limited), limited)
  assert.equal(betterAdvert(limited, live), live)
  assert.equal(betterAdvert(advert("1000000001", "active", "A", null), advert("999999999", "active", "A", null)).olxId, "1000000001")
})

test("matching links by SKU case-insensitively and marks one primary per variant", () => {
  const { matches, summary } = matchAdverts(
    [
      advert("101", "active", "KS-ELN-18V", null),
      advert("90", "outdated", "KS-ELN-18V", null),
      advert("102", "limited", null, "WZ-138 XD"),
      advert("103", "active", "NOT-IN-CATALOG", null),
      advert("104", "active", null, null),
    ],
    variants,
  )
  assert.equal(matches.get("101")?.variant?.id, "variant_1")
  assert.equal(matches.get("101")?.isPrimary, true)
  assert.equal(matches.get("90")?.variant?.id, "variant_1")
  assert.equal(matches.get("90")?.isPrimary, false)
  assert.equal(matches.get("102")?.variant?.id, "variant_2")
  assert.equal(matches.get("102")?.source, "description")
  assert.equal(matches.get("103")?.variant, null)
  assert.equal(matches.get("104")?.key, null)

  assert.equal(summary.adverts, 5)
  assert.equal(summary.linked, 3)
  assert.equal(summary.linkedVariants, 2)
  assert.equal(summary.linkedProducts, 2)
  assert.equal(summary.linkedLive, 1, "variant_2 is only over the limit, so not live")
  assert.equal(summary.unmatchedLive, 1)
  assert.deepEqual(summary.unmatchedLiveKeys, ["NOT-IN-CATALOG"])
  assert.equal(summary.noKey, 1)
  assert.deepEqual(summary.bySource, { external_id: 3, description: 1 })
})

test("catalog SKUs colliding after uppercasing are reported, the first one wins", () => {
  const { matches, summary } = matchAdverts(
    [advert("1", "active", "ab-1", null)],
    [
      { id: "v1", sku: "AB-1", productId: "p1", productTitle: null },
      { id: "v2", sku: "ab-1", productId: "p2", productTitle: null },
    ],
  )
  assert.equal(matches.get("1")?.variant?.id, "v1")
  assert.deepEqual(summary.ambiguousSkus, ["AB-1"])
})
