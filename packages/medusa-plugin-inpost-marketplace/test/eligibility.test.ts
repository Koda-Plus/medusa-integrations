/**
 * Offer eligibility: what blocks a listing (no EAN, a wrong check digit, no
 * brand, no GPSR manufacturer or an incomplete one, no PLN price, an
 * unpublished product), what only warns, where the GPSR manufacturer comes
 * from, and how the status of a row moves.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { eligibility, nextOfferStatus, normalizeEan, validGtin, type VariantFacts } from "../src/modules/vonhalsky/lib/eligibility.ts"
import { fromCompliance, fromMetadata, pickManufacturer } from "../src/modules/vonhalsky/lib/gpsr.ts"
import { offerPatch } from "../src/workflows/vonhalsky/offers.ts"

const MAKER = { name: "Maker Sp. z o.o.", email: "gpsr@example.com", address: "ul. Przykładowa 1, 00-001 Warszawa", phone: null }

const facts = (over: Partial<VariantFacts> = {}): VariantFacts => ({
  variantId: "variant_1",
  productId: "prod_1",
  sku: "SKU-1",
  title: "Ceramic mug",
  thumbnail: "https://cdn.example.com/mug.jpg",
  productStatus: "published",
  ean: "5901234123457",
  brand: "Brand",
  mpn: "MPN-1",
  manufacturer: MAKER,
  gpsrSource: "compliance",
  basePriceMinor: 4999,
  stock: 4,
  ...over,
})

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

test("eligibility: a complete variant is listable, with no warnings", () => {
  const e = eligibility(facts())
  assert.equal(e.listable, true)
  assert.deepEqual(e.reasons, [])
  assert.deepEqual(e.warnings, [])
})

test("eligibility: missing EAN or GPSR blocks the listing with the reason", () => {
  assert.deepEqual(eligibility(facts({ ean: null })).reasons, ["no_ean"])
  assert.deepEqual(eligibility(facts({ ean: "5901234123458" })).reasons, ["invalid_ean"])
  assert.deepEqual(eligibility(facts({ manufacturer: null, gpsrSource: null })).reasons, ["no_gpsr"])
  assert.deepEqual(eligibility(facts({ manufacturer: { ...MAKER, email: null } })).reasons, ["gpsr_incomplete"])
  assert.deepEqual(eligibility(facts({ manufacturer: { ...MAKER, address: null } })).reasons, ["gpsr_incomplete"])
  assert.deepEqual(eligibility(facts({ brand: " " })).reasons, ["no_brand"])
  assert.deepEqual(eligibility(facts({ basePriceMinor: null })).reasons, ["no_price"])
  assert.deepEqual(eligibility(facts({ productStatus: "draft" })).reasons, ["not_published"])
  const all = eligibility(facts({ title: null, ean: null, brand: null, manufacturer: null, basePriceMinor: 0 }))
  assert.equal(all.listable, false)
  assert.deepEqual(all.reasons, ["no_title", "no_ean", "no_brand", "no_gpsr", "no_price"])
})

test("eligibility: no MPN, no stock and no photo only warn", () => {
  const e = eligibility(facts({ mpn: null, stock: 0, thumbnail: null }))
  assert.equal(e.listable, true)
  assert.deepEqual(e.warnings, ["no_mpn", "no_stock", "no_image"])
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

test("offer status: fixed goes back to draft (never listed by itself), listed stays, closed stays closed", () => {
  assert.equal(nextOfferStatus(null, true), "draft")
  assert.equal(nextOfferStatus(null, false), "blocked")
  assert.equal(nextOfferStatus("blocked", true), "draft")
  assert.equal(nextOfferStatus("listed", true), "listed")
  assert.equal(nextOfferStatus("listed", false), "blocked")
  assert.equal(nextOfferStatus("closed", true), "closed")
})

test("offer row: reasons, price with markup, override kept, demo flag", () => {
  const pricing = { includesTax: true, vatRate: 23, markupPercent: 10 }
  const fresh = offerPatch(facts({ ean: null }), null, pricing, true)
  assert.equal(fresh.status, "blocked")
  assert.deepEqual(fresh.reasons, ["no_ean"])
  assert.equal(fresh.price_minor, 5499)
  assert.equal(fresh.demo, true)
  const overridden = offerPatch(facts(), { status: "listed", price_override_minor: 3999, demo: false }, pricing, true)
  assert.equal(overridden.status, "listed")
  assert.equal(overridden.price_minor, 3999, "the override wins over the markup")
  assert.equal(overridden.remote_status, "PUBLISHED")
  assert.equal(overridden.demo, false, "an existing row keeps its flag")
})
