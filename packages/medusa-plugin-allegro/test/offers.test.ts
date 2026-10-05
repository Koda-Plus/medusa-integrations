import { test } from "node:test"
import assert from "node:assert/strict"
import { offerFromApi, offersFromApi } from "../src/modules/allegro/lib/offers.ts"
import { matchOffers, statusGroup, type CatalogVariant } from "../src/modules/allegro/lib/matching.ts"

const apiOffer = (id: string, status: string, externalId: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Offer ${id}`,
  sellingMode: { format: "BUY_NOW", price: { amount: "129.99", currency: "PLN" } },
  stock: { available: 3, sold: 1 },
  publication: { status, startedAt: "2026-09-01T10:00:00.000Z" },
  external: externalId === null ? null : { id: externalId },
  category: { id: "257931" },
  ...extra,
})

test("parser: Allegro amounts are strings, signature is external.id, unknown fields are ignored", () => {
  const o = offerFromApi(apiOffer("17000000001", "ACTIVE", " KS-WK-18V ", { images: ["x"], description: "y" }))
  assert.ok(o)
  assert.equal(o.allegroId, "17000000001")
  assert.deepEqual(o.price, { value: 129.99, currency: "PLN" })
  assert.equal(o.externalId, "KS-WK-18V")
  assert.equal(o.available, 3)
  assert.equal(o.format, "BUY_NOW")
  assert.equal(o.startedAt, "2026-09-01T10:00:00.000Z")
  assert.equal((o as Record<string, unknown>).images, undefined)
})

test("parser: no id, no offer; missing status reads as draft; statuses are counted", () => {
  assert.equal(offerFromApi({ name: "x" }), null)
  const { offers, statuses } = offersFromApi([
    apiOffer("1", "ACTIVE", "A"),
    apiOffer("2", "ENDED", "B"),
    { id: "3", name: "no publication" },
    null,
  ])
  assert.equal(offers.length, 3)
  assert.equal(offers[2].status, "INACTIVE")
  assert.deepEqual(statuses, { ACTIVE: 1, ENDED: 1, INACTIVE: 1 })
})

test("status groups", () => {
  assert.equal(statusGroup("ACTIVE"), "live")
  assert.equal(statusGroup("ACTIVATING"), "activating")
  assert.equal(statusGroup("INACTIVE"), "draft")
  assert.equal(statusGroup("ENDED"), "ended")
  assert.equal(statusGroup("SOMETHING_NEW"), "ended")
})

const variants: CatalogVariant[] = [
  { id: "v1", sku: "KS-WK-18V", productId: "p1", productTitle: "Wkrętarka" },
  { id: "v2", sku: "ks-sz-125", productId: "p2", productTitle: "Szlifierka" },
  { id: "v3", sku: "KS-SZ-125", productId: "p3", productTitle: "Duplikat" },
]

test("matching: signature against SKU, case-insensitive, live beats ended, newest id wins a tie", () => {
  const offers = [
    { allegroId: "100", status: "ENDED", externalId: "KS-WK-18V" },
    { allegroId: "200", status: "ACTIVE", externalId: "ks-wk-18v" },
    { allegroId: "300", status: "ACTIVE", externalId: "KS-WK-18V" },
    { allegroId: "400", status: "ACTIVE", externalId: "KS-SZ-125" },
    { allegroId: "500", status: "ACTIVE", externalId: "UNKNOWN-1" },
    { allegroId: "600", status: "ACTIVE", externalId: null },
  ]
  const { matches, summary } = matchOffers(offers, variants)
  assert.equal(matches.get("300")?.isPrimary, true)
  assert.equal(matches.get("200")?.isPrimary, false)
  assert.equal(matches.get("100")?.isPrimary, false)
  assert.equal(matches.get("100")?.variant?.id, "v1")
  /* Duplicate SKU in the catalog: the first variant wins and the collision is reported. */
  assert.equal(matches.get("400")?.variant?.id, "v2")
  assert.deepEqual(summary.ambiguousSkus, ["KS-SZ-125"])
  assert.equal(summary.unmatchedLive, 1)
  assert.deepEqual(summary.unmatchedLiveKeys, ["UNKNOWN-1"])
  assert.equal(summary.noKey, 1)
  assert.equal(summary.linked, 4)
  assert.equal(summary.linkedLive, 2)
  assert.equal(summary.linkedProducts, 2)
})

test("matching: a draft never outranks a live offer, activating outranks a draft", () => {
  const { matches } = matchOffers(
    [
      { allegroId: "900", status: "INACTIVE", externalId: "KS-WK-18V" },
      { allegroId: "800", status: "ACTIVATING", externalId: "KS-WK-18V" },
    ],
    variants,
  )
  assert.equal(matches.get("800")?.isPrimary, true)
  assert.equal(matches.get("900")?.isPrimary, false)
})
