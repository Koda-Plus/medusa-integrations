import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions } from "../src/modules/ceneo/lib/options.ts"
import { buildOfferDraft, countDrafts, flagDuplicateIds, isInFeed, offerState, renderFeed, type CatalogVariant } from "../src/modules/ceneo/lib/feed.ts"
import { cdata, cutChars, xmlAttr, xmlClean } from "../src/modules/ceneo/lib/xml.ts"
import { availabilityByVariant } from "../src/modules/ceneo/lib/stock.ts"

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2"
const URL = "https://shop.example.com/pl/products/{handle}?variant={variant_id}"
const feed = (extra: Record<string, unknown> = {}) => resolveOptions({ feed: { token: TOKEN, productUrl: URL, ...extra } }).feed

function variant(over: Partial<CatalogVariant> = {}): CatalogVariant {
  return {
    id: "variant_01",
    sku: "SKU-1",
    title: "Default variant",
    ean: "5901234123457",
    barcode: null,
    midCode: "MID-1",
    manageInventory: true,
    allowBackorder: false,
    productId: "prod_01",
    productHandle: "kubek-ceramiczny",
    productTitle: "Kubek ceramiczny",
    productStatus: "published",
    multiVariant: false,
    description: "<p>Kubek 300 ml</p>",
    images: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    categoryPath: "Dom/Kuchnia/Kubki",
    price: { amount: 39.9, taxInclusive: true },
    available: 12,
    ...over,
  }
}

const codes = (v: CatalogVariant, o = feed()) => buildOfferDraft(v, o).problems.map((p) => p.code)

test("xml: CDATA survives ]]>, forbidden characters are dropped, attributes are escaped", () => {
  assert.equal(cdata("a]]>b"), "<![CDATA[a]]]]><![CDATA[>b]]>")
  assert.equal(xmlClean("a\u0000b\u0007c￾d"), "abcd")
  assert.equal(xmlAttr(`Tom & "Jerry" <x>`), "Tom &amp; &quot;Jerry&quot; &lt;x&gt;")
  assert.equal(cutChars("ab😀cd", 3), "ab😀")
})

test("feed: a complete variant is an ok offer with every field Ceneo needs", () => {
  const d = buildOfferDraft(variant(), feed())
  assert.equal(offerState(d.problems), "ok")
  assert.equal(d.offerId, "variant_01")
  assert.equal(d.url, "https://shop.example.com/pl/products/kubek-ceramiczny?variant=variant_01")
  assert.deepEqual(d.price, { amount: 39.9, currency_code: "pln" })
  assert.equal(d.avail, 1)
  assert.equal(d.stock, 12)
  assert.deepEqual(d.attrs, [["EAN", "5901234123457"], ["Kod producenta", "MID-1"]])
  assert.equal(isInFeed(d), true)
})

test("feed: the name says the variant only when the product has several", () => {
  assert.equal(buildOfferDraft(variant(), feed()).name, "Kubek ceramiczny")
  assert.equal(buildOfferDraft(variant({ multiVariant: true, title: "Czerwony" }), feed()).name, "Kubek ceramiczny Czerwony")
  const long = buildOfferDraft(variant({ productTitle: "x".repeat(200) }), feed())
  assert.equal(long.name.length, 150)
  assert.deepEqual(long.problems.map((p) => p.code), ["name_cut"])
})

test("feed: an unpublished product is left out and nothing else is reported", () => {
  const d = buildOfferDraft(variant({ productStatus: "draft", price: null }), feed())
  assert.deepEqual(d.problems.map((p) => p.code), ["unpublished"])
  assert.equal(offerState(d.problems), "excluded")
})

test("feed: a price without tax or without a value never reaches the file", () => {
  assert.deepEqual(codes(variant({ price: { amount: 39.9, taxInclusive: false } })), ["price_net"])
  assert.deepEqual(codes(variant({ price: null })), ["price_missing"])
  assert.deepEqual(codes(variant({ price: { amount: 0, taxInclusive: true } })), ["price_missing"])
  assert.equal(isInFeed(buildOfferDraft(variant({ price: null }), feed())), false)
})

test("feed: availability follows the stock, never guesses", () => {
  assert.equal(buildOfferDraft(variant({ manageInventory: false, available: undefined }), feed()).avail, 1)
  assert.equal(buildOfferDraft(variant({ manageInventory: false }), feed()).stock, null)
  const unknown = buildOfferDraft(variant({ available: undefined }), feed())
  assert.equal(unknown.avail, 99)
  assert.deepEqual(unknown.problems.map((p) => p.code), ["stock_unknown"])
  assert.equal(buildOfferDraft(variant({ available: 0, allowBackorder: true }), feed({ backorderAvail: 14 })).avail, 14)
  assert.deepEqual(codes(variant({ available: 0 })), ["out_of_stock"])
  const check = buildOfferDraft(variant({ available: 0 }), feed({ outOfStock: "check" }))
  assert.equal(check.avail, 99)
  assert.equal(check.stock, null)
})

test("feed: the address needs every placeholder it uses, and encodes values", () => {
  assert.deepEqual(codes(variant({ productHandle: null })), ["url_missing"])
  const sku = buildOfferDraft(variant({ sku: "A B/1" }), feed({ productUrl: "https://s.pl/p/{sku}" }))
  assert.equal(sku.url, "https://s.pl/p/A%20B%2F1")
  assert.deepEqual(codes(variant({ sku: null }), feed({ productUrl: "https://s.pl/p/{sku}" })), ["url_missing"])
})

test("feed: in sku mode a variant without a SKU has no id", () => {
  const d = buildOfferDraft(variant({ sku: null, midCode: null }), feed({ offerId: "sku" }))
  assert.equal(d.offerId, null)
  assert.deepEqual(d.problems.map((p) => p.code), ["sku_missing"])
})

test("feed: images are absolute, unique and at most 20; EAN is checked", () => {
  const many = Array.from({ length: 25 }, (_, i) => `https://cdn.example.com/${i}.jpg`)
  const d = buildOfferDraft(variant({ images: ["/static/x.jpg", ...many, many[0]] }), feed())
  assert.equal(d.images.length, 20)
  assert.deepEqual(d.problems.map((p) => p.code), ["image_url_invalid", "images_cut"])
  assert.deepEqual(codes(variant({ images: [] })), ["image_missing"])
  assert.deepEqual(codes(variant({ ean: "123", barcode: null })), ["ean_invalid"])
  assert.deepEqual(codes(variant({ ean: null, barcode: null })), ["ean_missing"])
  assert.deepEqual(codes(variant({ categoryPath: null })), ["category_missing"])
})

test("feed: two variants wanting one id both lose it", () => {
  const o = feed({ offerId: "sku" })
  const drafts = [buildOfferDraft(variant({ id: "v1" }), o), buildOfferDraft(variant({ id: "v2" }), o)]
  flagDuplicateIds(drafts)
  assert.deepEqual(drafts.map((d) => d.offerId), [null, null])
  assert.deepEqual(drafts.map((d) => offerState(d.problems)), ["error", "error"])
})

test("feed: the file holds only offers without errors, sorted, the same bytes every time", () => {
  const o = feed()
  const drafts = [
    buildOfferDraft(variant({ id: "v_b", productTitle: "Zażółć <gęślą> & jaźń" }), o),
    buildOfferDraft(variant({ id: "v_a" }), o),
    buildOfferDraft(variant({ id: "v_c", price: null }), o),
    buildOfferDraft(variant({ id: "v_d", available: 0 }), o),
  ]
  const xml = renderFeed(drafts)
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<offers xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1">'))
  assert.ok(xml.indexOf('id="v_a"') < xml.indexOf('id="v_b"'))
  assert.equal(xml.includes("v_c"), false)
  assert.equal(xml.includes("v_d"), false)
  assert.ok(xml.includes('price="39.90" avail="1" stock="12"'))
  assert.ok(xml.includes("<name><![CDATA[Zażółć <gęślą> & jaźń]]></name>"))
  assert.ok(xml.includes('<imgs><main url="https://cdn.example.com/a.jpg"/><i url="https://cdn.example.com/b.jpg"/></imgs>'))
  assert.equal(renderFeed([...drafts].reverse()), xml)
  assert.deepEqual(countDrafts(drafts), { offers: 2, warnings: 0, errors: 1, excluded: 1 })
  assert.equal(renderFeed([]), '<?xml version="1.0" encoding="UTF-8"?>\n<offers xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="1">\n</offers>\n')
})

test("stock: the minimum over inventory items, only the channel's locations, none linked counts nothing", () => {
  const links = [
    { variant_id: "v1", required_quantity: 2, inventory: { location_levels: [{ location_id: "sloc_a", available_quantity: 9 }, { location_id: "sloc_b", available_quantity: 100 }] } },
    { variant_id: "v1", required_quantity: 1, inventory: { location_levels: [{ location_id: "sloc_a", stocked_quantity: 10, reserved_quantity: 7 }] } },
  ]
  assert.equal(availabilityByVariant(links, new Set(["sloc_a"])).get("v1"), 3)
  assert.equal(availabilityByVariant(links, new Set()).get("v1"), 0)
  assert.equal(availabilityByVariant(links, new Set(["sloc_a"])).get("v2"), undefined)
})
