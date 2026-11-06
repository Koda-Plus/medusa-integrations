/**
 * Offer eligibility: what the seller API requires of an offer blocks a
 * listing (a title, an EAN or else the part number, a valid check digit, a
 * brand, a description, an image, a leaf category with its required
 * attributes, GPSR manufacturer name and e-mail unless the category or the
 * product is outside GPSR, a package that fits, a PLN price, a published
 * product), what only warns, where the GPSR manufacturer comes from, how
 * the status of a row moves, and the row a variant's facts make.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { eligibility, fitsPackage, nextOfferStatus, normalizeEan, validGtin, type OfferContext, type VariantFacts } from "../src/modules/vonhalsky/lib/eligibility.ts"
import { fromCompliance, fromMetadata, pickManufacturer } from "../src/modules/vonhalsky/lib/gpsr.ts"
import { offerPatch } from "../src/workflows/vonhalsky/offers.ts"

const MAKER = { name: "Maker Sp. z o.o.", email: "gpsr@example.com", address: "ul. Przykładowa 1, 00-001 Warszawa", phone: null }

const facts = (over: Partial<VariantFacts> = {}): VariantFacts => ({
  variantId: "variant_1",
  productId: "prod_1",
  sku: "SKU-1",
  title: "Ceramic mug",
  thumbnail: "https://cdn.example.com/mug.jpg",
  images: ["https://cdn.example.com/mug.jpg", "https://cdn.example.com/mug-side.jpg"],
  description: "<p>A mug.</p>",
  productStatus: "published",
  ean: "5901234123457",
  brand: "Brand",
  mpn: "MPN-1",
  manufacturer: MAKER,
  gpsrSource: "compliance",
  gpsrExempt: false,
  categoryIds: ["pcat_1"],
  dimension: { width: 100, height: 120, length: 90, weight: 350 },
  vatRate: null,
  basePriceMinor: 4999,
  stock: 4,
  ...over,
})

const CTX: OfferContext = { categoryId: "leaf-1", gpsrFree: false, requiredAttributes: null, attributes: [] }
const reasons = (over: Partial<VariantFacts> = {}, ctx: Partial<OfferContext> = {}) => eligibility(facts(over), { ...CTX, ...ctx }).reasons

test("EAN: digits only, the check digit of EAN-8, UPC-A, EAN-13 and GTIN-14", () => {
  assert.equal(normalizeEan(" 590 1234-123457 "), "5901234123457")
  assert.equal(normalizeEan(""), null)
  assert.equal(normalizeEan(null), null)
  assert.ok(validGtin("5901234123457"))
  assert.ok(!validGtin("5901234123458"))
  assert.ok(validGtin("96385074"))
  assert.ok(validGtin("036000291452"))
  assert.ok(validGtin("15901234123454"))
  assert.ok(!validGtin("12345"))
  assert.ok(!validGtin("59012341234AB"))
})

test("package: each side at most 1200 mm and the three at most 2200 mm", () => {
  assert.ok(fitsPackage({ width: 1200, height: 500, length: 500 }))
  assert.ok(!fitsPackage({ width: 1201, height: 10, length: 10 }))
  assert.ok(fitsPackage({ width: 1000, height: 600, length: 600 }))
  assert.ok(!fitsPackage({ width: 1000, height: 700, length: 600 }), "2300 mm together is too large")
})

test("eligibility: a complete variant in a leaf category is listable, with no warnings", () => {
  const e = eligibility(facts(), CTX)
  assert.equal(e.listable, true)
  assert.deepEqual(e.reasons, [])
  assert.deepEqual(e.warnings, [])
})

test("eligibility: without a chosen category nothing is listable", () => {
  const e = eligibility(facts())
  assert.equal(e.listable, false)
  assert.deepEqual(e.reasons, ["no_category"])
})

test("eligibility: no EAN is fine with a part number, a wrong check digit never is", () => {
  assert.deepEqual(reasons({ ean: null }), [], "brand and part number stand in for the EAN")
  assert.deepEqual(reasons({ ean: null, mpn: null }), ["no_ean"])
  assert.deepEqual(reasons({ ean: "5901234123458" }), ["invalid_ean"])
})

test("eligibility: GPSR needs the manufacturer's name and e-mail, the address is optional", () => {
  assert.deepEqual(reasons({ manufacturer: null, gpsrSource: null }), ["no_gpsr"])
  assert.deepEqual(reasons({ manufacturer: { ...MAKER, email: null } }), ["gpsr_incomplete"])
  assert.deepEqual(reasons({ manufacturer: { ...MAKER, name: " " } }), ["gpsr_incomplete"])
  assert.deepEqual(reasons({ manufacturer: { ...MAKER, address: null } }), [])
})

test("eligibility: no GPSR data is needed in a category outside GPSR or for a product on the market before 13 December 2024", () => {
  assert.deepEqual(reasons({ manufacturer: null, gpsrSource: null }, { gpsrFree: true }), [])
  assert.deepEqual(reasons({ manufacturer: null, gpsrSource: null, gpsrExempt: true }), [])
})

test("eligibility: what the offer itself needs blocks the listing with its own reason", () => {
  assert.deepEqual(reasons({ brand: " " }), ["no_brand"])
  assert.deepEqual(reasons({ description: "" }), ["no_description"])
  assert.deepEqual(reasons({ images: [] }), ["no_image"])
  assert.deepEqual(reasons({ basePriceMinor: null }), ["no_price"])
  assert.deepEqual(reasons({ basePriceMinor: 0 }), ["no_price"])
  assert.deepEqual(reasons({ productStatus: "draft" }), ["not_published"])
  assert.deepEqual(reasons({ dimension: { width: 1300, height: 100, length: 100, weight: 1000 } }), ["too_large"])
})

test("eligibility: a description that is only markup is no description", () => {
  assert.deepEqual(reasons({ description: "<p>&nbsp;</p>" }), ["no_description"])
  assert.deepEqual(reasons({ description: "<p></p><br/>" }), ["no_description"])
})

test("eligibility: required attributes of the category are checked once their definitions are known", () => {
  assert.deepEqual(reasons({}, { requiredAttributes: null }), [], "definitions not read yet")
  assert.deepEqual(reasons({}, { requiredAttributes: ["attr-color"] }), ["attributes_missing"])
  assert.deepEqual(reasons({}, { requiredAttributes: ["attr-color"], attributes: [{ id: "attr-color", values: [" "] }] }), ["attributes_missing"], "a blank value is no value")
  assert.deepEqual(reasons({}, { requiredAttributes: ["attr-color"], attributes: [{ id: "attr-color", values: ["czarny"] }] }), [])
})

test("eligibility: every missing piece is listed in a stable order", () => {
  const all = eligibility(facts({ title: null, ean: null, mpn: null, brand: null, description: null, images: [], manufacturer: null, basePriceMinor: 0 }))
  assert.equal(all.listable, false)
  assert.deepEqual(all.reasons, ["no_title", "no_ean", "no_brand", "no_description", "no_image", "no_category", "no_gpsr", "no_price"])
})

test("eligibility: no part number next to an EAN, no stock, no dimensions and one image only warn", () => {
  const e = eligibility(facts({ mpn: null, stock: 0, dimension: null, images: ["https://cdn.example.com/mug.jpg"] }), CTX)
  assert.equal(e.listable, true)
  assert.deepEqual(e.warnings, ["no_mpn", "no_stock", "no_dimensions", "one_image"])
})

test("GPSR: the compliance record wins, product metadata is the fallback", () => {
  const compliance = fromCompliance({ name: "Op", email: "op@example.com", address: "Street 1", metadata: { phone: "+48500000000" } })
  assert.deepEqual(compliance, { name: "Op", email: "op@example.com", address: "Street 1", phone: "+48500000000" })
  assert.equal(fromCompliance({ name: " " }), null)
  const nested = fromMetadata({ gpsr_manufacturer: { name: "Meta", email: "m@example.com", address: "Street 2" } })
  assert.equal(nested?.name, "Meta")
  assert.equal(fromMetadata({ gpsr_manufacturer: JSON.stringify({ name: "Json", email: "j@example.com" }) })?.email, "j@example.com")
  assert.deepEqual(fromMetadata({ manufacturer_name: "Flat", manufacturer_email: "f@example.com", manufacturer_address: "Street 3" }), { name: "Flat", email: "f@example.com", address: "Street 3", phone: null })
  assert.equal(fromMetadata({}), null)
  assert.equal(pickManufacturer(compliance, nested).source, "compliance")
  assert.equal(pickManufacturer(null, nested).source, "metadata")
  assert.deepEqual(pickManufacturer(null, null), { manufacturer: null, source: null })
})

test("offer status: fixed goes back to draft (never listed by itself), listed stays listed, closed stays closed", () => {
  assert.equal(nextOfferStatus(null, true), "draft")
  assert.equal(nextOfferStatus(null, false), "blocked")
  assert.equal(nextOfferStatus("blocked", true), "draft")
  assert.equal(nextOfferStatus("draft", false), "blocked")
  assert.equal(nextOfferStatus("listed", true), "listed")
  assert.equal(nextOfferStatus("listed", false), "listed", "a listed offer stays on the marketplace, its reasons say what to fix")
  assert.equal(nextOfferStatus("closed", true), "closed")
  assert.equal(nextOfferStatus("closed", false), "closed")
})

const PRICING = { includesTax: true, vatRate: 23, markupPercent: 10 }
const LEAF = { id: "leaf-1", source: "map" as const, info: { path: "Dom > Kubki", leaf: true, gpsrFree: false, required: null } }

test("offer row: reasons, the price with the markup, the category and the demo flag of a new row", () => {
  const fresh = offerPatch(facts({ ean: null, mpn: null }), null, PRICING, true, LEAF)
  assert.equal(fresh.status, "blocked")
  assert.deepEqual(fresh.reasons, ["no_ean"])
  assert.equal(fresh.price_minor, 5499)
  assert.equal(fresh.currency_code, "pln")
  assert.equal(fresh.category_id, "leaf-1")
  assert.equal(fresh.category_source, "map")
  assert.equal(fresh.demo, true)
  assert.equal(offerPatch(facts(), null, PRICING, false, LEAF).status, "draft")
})

test("offer row: the override wins over the markup and an existing row keeps its status and flag", () => {
  const overridden = offerPatch(facts(), { status: "listed", price_override_minor: 3999, demo: false, remote_id: "off-1" }, PRICING, true, LEAF)
  assert.equal(overridden.status, "listed")
  assert.equal(overridden.price_minor, 3999, "the override wins over the markup")
  assert.equal(overridden.demo, false, "a row with a remote offer keeps its flag")
  const neverSent = offerPatch(facts(), { status: "draft", demo: true, remote_id: null }, PRICING, false, LEAF)
  assert.equal(neverSent.demo, false, "a demo row never sent anywhere becomes real once the credentials are set")
})

test("offer row: net Medusa prices get the product's own VAT rate before the markup", () => {
  const net = { includesTax: false, vatRate: 23, markupPercent: 0 }
  assert.equal(offerPatch(facts({ basePriceMinor: 10000 }), null, net, false, LEAF).price_minor, 12300)
  assert.equal(offerPatch(facts({ basePriceMinor: 10000, vatRate: 8 }), null, net, false, LEAF).price_minor, 10800)
})

test("offer row: the category decides whether GPSR and attributes are needed", () => {
  const notLeaf = offerPatch(facts(), null, PRICING, false, { ...LEAF, info: { ...LEAF.info, leaf: false } })
  assert.deepEqual(notLeaf.reasons, ["no_category"], "a category that is not a leaf is no category")
  const outsideGpsr = offerPatch(facts({ manufacturer: null, gpsrSource: null }), null, PRICING, false, { ...LEAF, info: { ...LEAF.info, gpsrFree: true } })
  assert.deepEqual(outsideGpsr.reasons, [])
  const required = { ...LEAF, info: { ...LEAF.info, required: ["attr-color"] } }
  assert.deepEqual(offerPatch(facts(), null, PRICING, false, required).reasons, ["attributes_missing"])
  assert.deepEqual(offerPatch(facts(), { status: "draft", attributes: [{ id: "attr-color", values: ["czarny"] }] }, PRICING, false, required).reasons, [])
  assert.deepEqual(offerPatch(facts(), null, PRICING, false, { id: null, source: null, info: null }).reasons, ["no_category"])
})

test("pictures the marketplace refuses (AVIF, SVG, HEIC) are left out, the rest keep their order", async () => {
  const { imagesOf, imageAccepted } = await import("../src/workflows/vonhalsky/catalog.ts")
  assert.equal(imageAccepted("https://cdn.example.com/a.avif"), false)
  assert.equal(imageAccepted("https://cdn.example.com/a.AVIF?v=2"), false)
  assert.equal(imageAccepted("https://cdn.example.com/a.svg"), false)
  assert.equal(imageAccepted("https://cdn.example.com/a.jpg"), true)
  assert.equal(imageAccepted("https://cdn.example.com/image?id=7"), true, "no extension: sent as it is")
  assert.deepEqual(
    imagesOf({ thumbnail: "https://cdn.example.com/hod.avif", images: [{ url: "https://cdn.example.com/hod-2.png", rank: 1 }, { url: "https://cdn.example.com/hod.jpg", rank: 0 }] }),
    ["https://cdn.example.com/hod.jpg", "https://cdn.example.com/hod-2.png"],
  )
})

test("the offer name has the variant title only when the product has more variants", async () => {
  const { offerTitle } = await import("../src/workflows/vonhalsky/catalog.ts")
  assert.equal(offerTitle("Bluza z kapturem", "Standard", 1), "Bluza z kapturem")
  assert.equal(offerTitle("Bluza z kapturem", "M", 3), "Bluza z kapturem M")
  assert.equal(offerTitle("Bluza z kapturem", "Default variant", 2), "Bluza z kapturem")
  assert.equal(offerTitle(null, "M", 3), "M")
})
