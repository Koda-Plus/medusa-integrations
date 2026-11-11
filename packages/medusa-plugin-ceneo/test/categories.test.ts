import { test } from "node:test"
import assert from "node:assert/strict"
import { effectiveMapping, parseCeneoTree, planCategorySync, productCeneoCategory } from "../src/modules/ceneo/lib/categories.ts"
import { brandOf } from "../src/modules/ceneo/lib/brand.ts"
import { resolveOptions } from "../src/modules/ceneo/lib/options.ts"
import { buildOfferDraft, cutHtml, type CatalogVariant } from "../src/modules/ceneo/lib/feed.ts"
import { checkTakeOver } from "../src/modules/ceneo/lib/offers.ts"

/* The shape of https://developers.ceneo.pl/api/v3/kategorie, cut down. */
const TREE =
  '<ArrayOfCategory><Category><Id>2286</Id><Name>Biuro i firma</Name><Subcategories><Category><Id>1485</Id><Name>Artykuły BHP</Name><Subcategories>' +
  "<Category><Id>2319</Id><Name>Instrukcje i znaki BHP</Name><Subcategories /></Category><Category><Id>3497</Id><Name>Kaski &amp; czapki</Name><Subcategories /></Category>" +
  "</Subcategories></Category></Subcategories></Category><Category><Id>10</Id><Name>Dom</Name><Subcategories /></Category></ArrayOfCategory>"

test("tree: parsed into paths, parents before children, leaves marked, entities decoded", () => {
  const nodes = parseCeneoTree(TREE)
  assert.deepEqual(nodes.map((n) => n.ceneoId), ["2286", "1485", "2319", "3497", "10"])
  const kask = nodes.find((n) => n.ceneoId === "3497")
  assert.equal(kask?.path, "Biuro i firma/Artykuły BHP/Kaski & czapki")
  assert.equal(kask?.parentCeneoId, "1485")
  assert.equal(kask?.depth, 2)
  assert.deepEqual(nodes.map((n) => n.leaf), [false, false, true, true, true])
})

test("tree: anything but the expected document throws, so a bad download changes nothing", () => {
  assert.throws(() => parseCeneoTree("<html><body>503</body></html>"))
  assert.throws(() => parseCeneoTree("<ArrayOfCategory><Category><Id>1</Id><Name>A</Name>"))
  assert.throws(() => parseCeneoTree("<ArrayOfCategory><Category><Id>x</Id><Name>A</Name></Category></ArrayOfCategory>"))
  assert.throws(() => parseCeneoTree("<ArrayOfCategory><Category><Id>1</Id><Name>A</Name></Category><Category><Id>1</Id><Name>B</Name></Category></ArrayOfCategory>"))
})

test("tree sync: new, changed and gone categories, an unchanged tree writes nothing", () => {
  const nodes = parseCeneoTree(TREE)
  const first = planCategorySync([], nodes)
  assert.equal(first.create.length, 5)
  const rows = first.create.map((d, i) => ({ id: `cct_${i}`, ...d }))
  assert.deepEqual(planCategorySync(rows, nodes), { create: [], update: [], deactivate: [] })
  const renamed = rows.map((r) => (r.ceneo_id === "10" ? { ...r, name: "Stary dom", path: "Stary dom" } : r))
  const plan = planCategorySync([...renamed, { id: "cct_x", ceneo_id: "999", name: "Old", path: "Old", active: true }], nodes)
  assert.deepEqual(plan.update.map((u) => u.data.ceneo_id), ["10"])
  assert.deepEqual(plan.deactivate, ["cct_x"])
})

test("mapping: a parent's mapping covers its subtree, a child's own wins, the deepest category decides", () => {
  const parents = new Map<string, string | null>([["root", null], ["kitchen", "root"], ["mugs", "kitchen"], ["garden", null]])
  const maps = new Map([["root", "10"], ["mugs", "2319"]])
  assert.deepEqual(effectiveMapping("kitchen", parents, maps), { ceneoId: "10", fromCategoryId: "root", inherited: true })
  assert.deepEqual(effectiveMapping("mugs", parents, maps), { ceneoId: "2319", fromCategoryId: "mugs", inherited: false })
  assert.equal(effectiveMapping("garden", parents, maps), null)
  assert.deepEqual(productCeneoCategory(["kitchen", "mugs", "garden"], parents, maps), { ceneoId: "2319", categoryId: "mugs" })
  assert.deepEqual(productCeneoCategory(["garden", "kitchen"], parents, maps), { ceneoId: "10", categoryId: "kitchen" })
  const loop = new Map<string, string | null>([["a", "b"], ["b", "a"]])
  assert.equal(effectiveMapping("a", loop, new Map()), null)
})

const base = { token: "a1b2c3d4e5f6a7b8c9d0e1f2", productUrl: "https://s.pl/p/{handle}" }

function variant(over: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    id: "v1", sku: "S1", title: null, ean: "5901234123457", barcode: null, midCode: null, manageInventory: false, allowBackorder: false,
    productId: "p1", productHandle: "kubek", productTitle: "Kubek", productStatus: "published", multiVariant: false, description: null,
    images: ["https://c.pl/a.jpg"], categoryPath: "Dom/Kuchnia", categoryIds: ["c1"], ceneoCategory: null, brand: "Ćmielów",
    price: { amount: 10, taxInclusive: true }, available: undefined, ...over,
  }
}

const codes = (v: CatalogVariant, extra: Record<string, unknown> = {}) => buildOfferDraft(v, resolveOptions({ feed: { ...base, ...extra } }).feed).problems.map((p) => p.code)

test("feed: a mapped category sends the Ceneo path and id, otherwise the store path with a warning", () => {
  const o = resolveOptions({ feed: base }).feed
  const mapped = buildOfferDraft(variant({ ceneoCategory: { ceneoId: "2319", path: "Biuro i firma/Artykuły BHP/Instrukcje i znaki BHP", active: true } }), o)
  assert.equal(mapped.category, "Biuro i firma/Artykuły BHP/Instrukcje i znaki BHP")
  assert.equal(mapped.ceneoCategoryId, "2319")
  assert.deepEqual(mapped.problems, [])
  assert.deepEqual(codes(variant()), ["category_unmapped"])
  assert.deepEqual(codes(variant(), { includeUnmapped: false }), ["category_required"])
  assert.deepEqual(codes(variant({ ceneoCategory: { ceneoId: "5", path: "", active: false } })), ["category_removed"])
  assert.equal(buildOfferDraft(variant({ ceneoCategory: { ceneoId: "5", path: "", active: false } }), o).category, "Dom/Kuchnia")
})

test("feed: the brand goes first in the attributes, a missing one is a warning, brand: false sends none", () => {
  const o = resolveOptions({ feed: base }).feed
  const d = buildOfferDraft(variant({ ceneoCategory: { ceneoId: "1", path: "Dom", active: true } }), o)
  assert.deepEqual(d.attrs[0], ["Marka", "Ćmielów"])
  assert.deepEqual(codes(variant({ brand: null, ceneoCategory: { ceneoId: "1", path: "Dom", active: true } })), ["brand_missing"])
  assert.deepEqual(codes(variant({ brand: null, ceneoCategory: { ceneoId: "1", path: "Dom", active: true } }), { brand: false }), [])
})

test("brand: read from metadata, type, collection or a tag prefix", () => {
  const p = { metadata: { brand: " Bosch ", marka: "X" }, type: { value: "Makita" }, collection: { title: "Fiskars" }, tags: [{ value: "promo" }, { value: "Marka:Gerlach" }] }
  assert.equal(brandOf(p, resolveOptions({}).feed.brand), "Bosch")
  assert.equal(brandOf(p, resolveOptions({ feed: { brand: { from: "metadata", key: "marka" } } }).feed.brand), "X")
  assert.equal(brandOf(p, resolveOptions({ feed: { brand: { from: "type" } } }).feed.brand), "Makita")
  assert.equal(brandOf(p, resolveOptions({ feed: { brand: { from: "collection" } } }).feed.brand), "Fiskars")
  assert.equal(brandOf(p, resolveOptions({ feed: { brand: { from: "tag", key: "marka:" } } }).feed.brand), "Gerlach")
  assert.equal(resolveOptions({ feed: { brand: { from: "tag" } } }).feed.brand, null)
  assert.equal(brandOf({ tags: [{ value: "Marka:" }, { value: "marka: Gerlach" }] }, resolveOptions({ feed: { brand: { from: "tag", key: "marka:" } } }).feed.brand), "Gerlach")
})

test("feed: a / in the SKU used in the address is a warning; HTML is never cut inside a tag", () => {
  assert.ok(codes(variant({ sku: "AB/12" }), { productUrl: "https://s.pl/p/{sku}" }).includes("url_slash"))
  assert.equal(codes(variant({ sku: "AB/12" })).includes("url_slash"), false)
  assert.equal(cutHtml("<p>abc</p><b class=\"x\">def", 15), "<p>abc</p>")
  assert.equal(cutHtml("<p>abcdef</p>", 6), "<p>abc")
})

test("take over: only from a variant that left the catalog, never from a living one", () => {
  const requester = { id: "cof_new", variant_id: "v_new", offer_id: null, problems: [{ code: "offer_id_taken", detail: "S1" }] }
  const holder = { id: "cof_old", variant_id: "v_old", offer_id: "S1", problems: [{ code: "variant_gone" }] }
  assert.deepEqual(checkTakeOver(requester, holder, holder), { ok: true })
  assert.deepEqual(checkTakeOver(requester, holder, holder, true), { ok: false, code: "holder_active" }, "off the channel, still in Medusa")
  assert.deepEqual(checkTakeOver(requester, { ...holder, problems: null }, undefined, false), { ok: true }, "Medusa decides over a stale build")
  assert.deepEqual(checkTakeOver(requester, { ...holder, retired_at: "2026-11-01T00:00:00Z" }, undefined), { ok: true }, "retired holder without an active row")
  const living = { ...holder, problems: null }
  assert.deepEqual(checkTakeOver(requester, living, living), { ok: false, code: "holder_active" })
  assert.deepEqual(checkTakeOver({ ...requester, problems: [] }, holder, holder), { ok: false, code: "not_taken" })
  assert.deepEqual(checkTakeOver(requester, undefined, undefined), { ok: false, code: "holder_missing" })
  const retiredHolder = { ...holder, retired_at: "2026-11-01T00:00:00Z", problems: [{ code: "offer_id_replaced" }] }
  assert.deepEqual(checkTakeOver(requester, retiredHolder, { id: "cof_cur", variant_id: "v_old", offer_id: "v_old", problems: [{ code: "variant_gone" }] }), { ok: true })
})
