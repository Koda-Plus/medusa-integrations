import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/ceneo/lib/options.ts"
import { buildOfferDraft, flagDuplicateIds, isGtin, offerState, type CatalogVariant } from "../src/modules/ceneo/lib/feed.ts"
import { planOfferSync, rowData, type OfferRowLite } from "../src/modules/ceneo/lib/offer-sync.ts"
import { planFeedWrite, shrinkGuard } from "../src/modules/ceneo/lib/store.ts"
import { feedTokenFromParam, sameToken } from "../src/modules/ceneo/lib/token.ts"
import { feedDue } from "../src/modules/ceneo/lib/schedule.ts"

const base = { token: "a1b2c3d4e5f6a7b8c9d0e1f2", productUrl: "https://s.pl/p/{handle}" }
const byVariant = resolveOptions({ feed: base }).feed
const bySku = resolveOptions({ feed: { ...base, offerId: "sku" } }).feed

function variant(id: string, sku: string | null): CatalogVariant {
  return {
    id, sku, title: null, ean: "5901234123457", barcode: null, midCode: null, manageInventory: false, allowBackorder: false,
    productId: "prod_1", productHandle: "h", productTitle: "Kubek", productStatus: "published", multiVariant: false,
    description: null, images: ["https://c.pl/a.jpg"], categoryPath: "Dom", price: { amount: 10, taxInclusive: true }, available: undefined,
  }
}

function row(id: string, variantId: string, offerId: string | null, retired = false): OfferRowLite {
  return { id, variant_id: variantId, offer_id: offerId, retired_at: retired ? "2026-11-01T00:00:00.000Z" : null }
}

test("sync: a new variant gets a new row", () => {
  const plan = planOfferSync([buildOfferDraft(variant("v1", "S1"), byVariant)], [])
  assert.equal(plan.create.length, 1)
  assert.equal(plan.create[0].offer_id, "v1")
})

test("sync: an unchanged offer writes nothing", () => {
  const d = buildOfferDraft(variant("v1", "S1"), byVariant)
  const existing = { ...row("cof_1", "v1", "v1"), ...rowData(d, "v1") }
  const plan = planOfferSync([buildOfferDraft(variant("v1", "S1"), byVariant)], [existing])
  assert.deepEqual(plan, { retire: [], update: [], create: [], gone: [] })
})

test("sync: switching to SKU ids retires the old row with its id and opens a new one", () => {
  const plan = planOfferSync([buildOfferDraft(variant("v1", "S1"), bySku)], [row("cof_1", "v1", "v1")])
  assert.deepEqual(plan.retire, ["cof_1"])
  assert.equal(plan.create[0].offer_id, "S1")
})

test("sync: switching back revives the retired row instead of reusing its id elsewhere", () => {
  const plan = planOfferSync([buildOfferDraft(variant("v1", "S1"), byVariant)], [row("cof_1", "v1", "v1", true), row("cof_2", "v1", "S1")])
  assert.deepEqual(plan.retire, ["cof_2"])
  assert.equal(plan.update.length, 1)
  assert.equal(plan.update[0].id, "cof_1")
  assert.equal(plan.update[0].revive, true)
  assert.equal(plan.create.length, 0)
})

test("sync: an id another variant ever held is refused", () => {
  const d = buildOfferDraft(variant("v2", "S1"), bySku)
  const plan = planOfferSync([d], [row("cof_1", "v1", "S1", true)])
  assert.equal(d.offerId, null)
  assert.deepEqual(d.problems.map((p) => p.code), ["offer_id_taken"])
  assert.equal(plan.create[0].offer_id, null)
  assert.equal(plan.create[0].state, "error")
  assert.equal(plan.create[0].in_feed, false)
})

test("sync: a variant without an id this time keeps the one it holds", () => {
  const plan = planOfferSync([buildOfferDraft(variant("v1", null), bySku)], [row("cof_1", "v1", "S1")])
  assert.equal(plan.update[0].data.offer_id, "S1")
  assert.equal(plan.update[0].data.state, "error")
})

test("sync: a variant gone from the catalog keeps its row, marked once", () => {
  const plan = planOfferSync([], [row("cof_1", "v1", "v1"), row("cof_2", "v2", "v2", true)])
  assert.deepEqual(plan.gone, ["cof_1"])
  const again = planOfferSync([], [{ ...row("cof_1", "v1", "v1"), state: "excluded", in_feed: false, problems: [{ code: "variant_gone" }] }])
  assert.deepEqual(again.gone, [])
})

test("feed row: the same file refreshes the newest build, a new file gets a new row", () => {
  assert.deepEqual(planFeedWrite({ id: "cfd_1", hash: "h1" }, "h1"), { kind: "touch", id: "cfd_1" })
  assert.deepEqual(planFeedWrite({ id: "cfd_1", hash: "h1" }, "h2"), { kind: "insert" })
  assert.deepEqual(planFeedWrite(null, "h1"), { kind: "insert" })
})

test("guard: a scheduled build never takes most offers off Ceneo, Build now may shrink but never empty", () => {
  assert.equal(shrinkGuard(null, 0, false), null)
  assert.equal(shrinkGuard(0, 0, false), null)
  assert.equal(shrinkGuard(100, 0, true), "empty")
  assert.equal(shrinkGuard(100, 40, false), "shrunk")
  assert.equal(shrinkGuard(100, 40, true), null)
  assert.equal(shrinkGuard(100, 60, false), null)
  assert.equal(shrinkGuard(10, 2, false), null)
})

test("duplicates: the variant that already holds the SKU keeps it, the newcomer is refused", () => {
  const drafts = [buildOfferDraft(variant("v_old", "S1"), bySku), buildOfferDraft(variant("v_new", "S1"), bySku)]
  const rows = [row("cof_1", "v_old", "S1")]
  flagDuplicateIds(drafts, (id) => (id === "S1" ? "v_old" : undefined))
  planOfferSync(drafts, rows)
  assert.equal(drafts[0].offerId, "S1")
  assert.equal(offerState(drafts[0].problems), "ok")
  assert.deepEqual(drafts[1].problems.map((p) => p.code), ["offer_id_taken"])
})

test("ean: the check digit is verified", () => {
  assert.equal(isGtin("5901234123457"), true)
  assert.equal(isGtin("5901234123458"), false)
  assert.equal(isGtin("96385074"), true)
  assert.equal(isGtin("036000291452"), true)
})

test("token: the .xml suffix is cut and the comparison is exact", () => {
  assert.equal(feedTokenFromParam("abc.xml"), "abc")
  assert.equal(feedTokenFromParam("abc"), "abc")
  assert.equal(feedTokenFromParam(".xml"), null)
  assert.equal(feedTokenFromParam(undefined), null)
  assert.equal(sameToken("a1b2c3d4e5f6a7b8c9d0", "a1b2c3d4e5f6a7b8c9d0"), true)
  assert.equal(sameToken("a1b2c3d4e5f6a7b8c9d", "a1b2c3d4e5f6a7b8c9d0"), false)
})

test("schedule: first build at once, then every interval, a change after 5 minutes", () => {
  const min = 60_000
  const now = 1_000 * min
  assert.deepEqual(feedDue(now, null, 30, null), { due: true, trigger: "first" })
  assert.deepEqual(feedDue(now, now - 10 * min, 30, null), { due: false })
  assert.deepEqual(feedDue(now, now - 29 * min, 30, null), { due: true, trigger: "schedule" })
  assert.deepEqual(feedDue(now, now - 2 * min, 30, now - min), { due: false })
  assert.deepEqual(feedDue(now, now - 6 * min, 30, now - min), { due: true, trigger: "change" })
  assert.deepEqual(feedDue(now, now - 6 * min, 30, now - 7 * min), { due: false })
})
