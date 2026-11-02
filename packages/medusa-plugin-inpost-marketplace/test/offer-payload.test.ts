/**
 * What an offer looks like on the wire (`OfferProposal`, OpenAPI 1.7.6):
 * the description as plain text with its paragraph breaks, phones in the
 * API's `+48...` shape, image file names the API accepts, and the proposal
 * itself: GPSR left out in a category outside GPSR, declared exempt for a
 * product on the market before 13 December 2024, the manufacturer
 * otherwise; the tax rate as "23%"; images with priorities from 1; the
 * package dimension whole or not at all; every text cut to the API's limit.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { apiPhone, buildProposal, fileNameOf, plainText, type ProposalInput } from "../src/modules/vonhalsky/lib/offer-payload.ts"

const MAKER = { name: "Maker Sp. z o.o.", email: "gpsr@example.com", address: "ul. Przykładowa 1, 00-001 Warszawa", phone: "501 606 802" }

const input = (over: Partial<ProposalInput> = {}, row: Partial<ProposalInput["row"]> = {}, facts: Partial<ProposalInput["facts"]> = {}): ProposalInput => ({
  row: { variant_id: "variant_1", title: "Ceramic mug", sku: "SKU-1", ean: "590-1234-123457", brand: "Brand", mpn: "MPN-1", price_minor: 4999, stock: 3, ...row },
  facts: {
    description: "<p>A mug.</p>",
    images: ["https://cdn.example.com/mug.jpg", "https://cdn.example.com/mug-side.jpg"],
    dimension: { width: 100, height: 120, length: 90, weight: 350 },
    manufacturer: MAKER,
    gpsrExempt: false,
    vatRate: null,
    ...facts,
  },
  categoryId: "leaf-1",
  gpsrFree: false,
  defaults: { daysToShip: 2, returnPolicy: "", complaintPolicy: "" },
  vatRate: 23,
  ...over,
})

test("plain text: HTML goes, paragraphs and list items stay on their own lines", () => {
  const html = "<p>Kubek <b>ceramiczny</b>.</p><p>Pojemność 300&nbsp;ml &amp; ucho.</p><ul><li>Biały</li><li>Do zmywarki</li></ul>"
  assert.equal(plainText(html), "Kubek ceramiczny.\nPojemność 300 ml & ucho.\n- Biały\n- Do zmywarki")
  assert.equal(plainText("Pierwszy</p>\n\n<p>Drugi"), "Pierwszy\n\nDrugi", "a blank line between paragraphs is kept, more is folded")
  assert.equal(plainText("Linia<br>druga<br/>trzecia<BR />"), "Linia\ndruga\ntrzecia")
  assert.equal(plainText("<h2>Tytuł</h2>Tekst   \nDalej"), "Tytuł\nTekst\nDalej", "spaces before a break go")
  assert.equal(plainText("&quot;Cytat&quot; i &#39;apostrof&#39; &lt;tag&gt;"), "\"Cytat\" i 'apostrof' <tag>")
  assert.equal(plainText("&amp;lt;"), "&lt;", "an entity is decoded once")
})

test("plain text: nothing is an empty text, and the length is cut", () => {
  assert.equal(plainText(null), "")
  assert.equal(plainText(undefined), "")
  assert.equal(plainText("<p></p>"), "")
  assert.equal(plainText("x".repeat(50), 10), "x".repeat(10))
})

test("phone: nine digits are Polish, 00 becomes +, anything else the API refuses is left out", () => {
  assert.equal(apiPhone("501 606 802"), "+48501606802")
  assert.equal(apiPhone("(501) 606-802"), "+48501606802")
  assert.equal(apiPhone("0048501606802"), "+48501606802")
  assert.equal(apiPhone("+48 501 606 802"), "+48501606802")
  assert.equal(apiPhone("+420 601 123 456"), "+420601123456")
  assert.equal(apiPhone("12"), undefined)
  assert.equal(apiPhone("tel. 501606802"), undefined)
  assert.equal(apiPhone("+1234567890123456"), undefined, "more than 15 digits")
  assert.equal(apiPhone(null), undefined)
  assert.equal(apiPhone(""), undefined)
})

test("image file name: from the URL, cleaned, a numbered fallback when too short or unreadable", () => {
  assert.equal(fileNameOf("https://cdn.example.com/images/kubek%20bia%C5%82y.jpg?w=800", 0), "kubek-bia-y.jpg")
  assert.equal(fileNameOf("https://cdn.example.com/products/mug.jpg", 0), "mug.jpg")
  assert.equal(fileNameOf("https://cdn.example.com/a.p", 2), "image-3.jpg")
  assert.equal(fileNameOf("not a url", 0), "image-1.jpg")
})

test("proposal: the product, its keys, the stock and the gross price", () => {
  const p = buildProposal(input())
  assert.equal(p.externalId, "variant_1")
  assert.deepEqual(p.product, {
    name: "Ceramic mug",
    description: "A mug.",
    brand: "Brand",
    categoryId: "leaf-1",
    sku: "SKU-1",
    manufacturerProductNumber: "MPN-1",
    ean: "5901234123457",
    dimension: { width: 100, height: 120, length: 90, weight: 350 },
  })
  assert.deepEqual(p.stock, { quantity: 3, unit: "UNIT" })
  assert.deepEqual(p.price, { grossPrice: { amount: 49.99, currency: "PLN" }, taxRateInfo: "23%" })
  assert.deepEqual(p.shippingTime, { daysToShip: 2 })
  assert.equal("postSale" in p, false, "no policy texts, the marketplace's own rules")
})

test("proposal: the tax rate is the product's own, else the default", () => {
  assert.equal(buildProposal(input({ vatRate: 23 })).price.taxRateInfo, "23%")
  assert.equal(buildProposal(input({}, {}, { vatRate: 8 })).price.taxRateInfo, "8%")
  assert.equal(buildProposal(input({ vatRate: 5 })).price.taxRateInfo, "5%")
})

test("proposal: no GPSR in a category outside GPSR", () => {
  const p = buildProposal(input({ gpsrFree: true }))
  assert.equal("gpsr" in p, false)
  assert.equal("gpsr" in buildProposal(input({ gpsrFree: true }, {}, { gpsrExempt: true })), false, "the category wins over the product")
})

test("proposal: a product on the market before 13 December 2024 is declared exempt", () => {
  assert.deepEqual(buildProposal(input({}, {}, { gpsrExempt: true })).gpsr, { doesNotRequireGpsrInfo: true })
})

test("proposal: otherwise the manufacturer with its name, e-mail, API phone and address", () => {
  assert.deepEqual(buildProposal(input()).gpsr, {
    manufacturer: { name: "Maker Sp. z o.o.", email: "gpsr@example.com", phone: "+48501606802", unstructuredAddress: "ul. Przykładowa 1, 00-001 Warszawa" },
  })
  assert.deepEqual(buildProposal(input({}, {}, { manufacturer: { ...MAKER, phone: "n/a", address: null } })).gpsr, { manufacturer: { name: "Maker Sp. z o.o.", email: "gpsr@example.com" } })
  assert.equal("gpsr" in buildProposal(input({}, {}, { manufacturer: { ...MAKER, email: null } })), false, "no e-mail, no manufacturer block")
  assert.equal("gpsr" in buildProposal(input({}, {}, { manufacturer: null })), false)
})

test("proposal: images keep their order with priorities from 1, at most 20", () => {
  const p = buildProposal(input())
  assert.deepEqual(p.images, [
    { fileName: "mug.jpg", fileUrl: "https://cdn.example.com/mug.jpg", priority: 1 },
    { fileName: "mug-side.jpg", fileUrl: "https://cdn.example.com/mug-side.jpg", priority: 2 },
  ])
  const many = buildProposal(input({}, {}, { images: Array.from({ length: 25 }, (_, i) => `https://cdn.example.com/photo-${i}.jpg`) }))
  assert.equal(many.images.length, 20)
  assert.equal(many.images[19].priority, 20)
})

test("proposal: the package dimension goes whole or not at all", () => {
  assert.deepEqual(buildProposal(input()).product.dimension, { width: 100, height: 120, length: 90, weight: 350 })
  assert.equal("dimension" in buildProposal(input({}, {}, { dimension: null })).product, false)
})

test("proposal: texts are cut to the API's limits and empty keys are left out", () => {
  const p = buildProposal(input({}, { title: `  ${"N".repeat(200)}  `, brand: "B".repeat(150), sku: "S".repeat(150), mpn: "M".repeat(300), ean: null }))
  assert.equal(p.product.name.length, 150)
  assert.equal(p.product.brand.length, 100)
  assert.equal(p.product.sku?.length, 100)
  assert.equal(p.product.manufacturerProductNumber?.length, 255)
  assert.equal("ean" in p.product, false)
  const bare = buildProposal(input({}, { title: null, brand: null, sku: null, mpn: null, ean: "" }))
  assert.equal(bare.product.name, "")
  assert.equal(bare.product.brand, "")
  for (const key of ["sku", "manufacturerProductNumber", "ean", "attributes"]) assert.equal(key in bare.product, false, key)
})

test("proposal: stock and days to ship are whole numbers in the API's range", () => {
  assert.equal(buildProposal(input({}, { stock: -3 })).stock.quantity, 0)
  assert.equal(buildProposal(input({}, { stock: 2_000_000 })).stock.quantity, 999_999)
  assert.equal(buildProposal(input({}, { stock: null })).stock.quantity, 0)
  assert.equal(buildProposal(input({ defaults: { daysToShip: 75, returnPolicy: "", complaintPolicy: "" } })).shippingTime.daysToShip, 60)
  assert.equal(buildProposal(input({ defaults: { daysToShip: 2.6, returnPolicy: "", complaintPolicy: "" } })).shippingTime.daysToShip, 3)
  assert.equal(buildProposal(input({}, { price_minor: null })).price.grossPrice.amount, 0)
})

test("proposal: attributes with values go in Polish, empty ones are dropped", () => {
  const p = buildProposal(input({}, { attributes: [{ id: "attr-color", values: [" czarny ", ""] }, { id: "attr-empty", values: [] }, { values: ["x"] }, "junk"] }))
  assert.deepEqual(p.product.attributes, [{ id: "attr-color", lang: "pl", values: ["czarny"] }])
})

test("proposal: the return and complaint policies go out only when written", () => {
  const p = buildProposal(input({ defaults: { daysToShip: 2, returnPolicy: "30 dni na zwrot.", complaintPolicy: "" } }))
  assert.deepEqual(p.postSale, { returnPolicy: { description: "30 dni na zwrot." } })
  const both = buildProposal(input({ defaults: { daysToShip: 2, returnPolicy: "Zwroty.", complaintPolicy: "Reklamacje." } }))
  assert.deepEqual(both.postSale, { returnPolicy: { description: "Zwroty." }, complaintPolicy: { description: "Reklamacje." } })
})
