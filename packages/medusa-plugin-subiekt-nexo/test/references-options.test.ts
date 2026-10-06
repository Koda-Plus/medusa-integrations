import { test } from "node:test"
import assert from "node:assert/strict"
import { localized, normalizeReferences, normalizeReview } from "../src/modules/subiekt/lib/references.ts"
import { optionWarnings, resolveOptions } from "../src/modules/subiekt/lib/options.ts"
import { DEFAULT_NIP_SOURCES } from "../src/modules/subiekt/lib/constants.ts"

test("references are validated leniently: bad entries and fields are dropped, nothing throws", () => {
  const refs = normalizeReferences([
    {
      name: "Sklep A",
      url: "https://www.sklep-a.example",
      description: { en: "Cosmetics", pl: "Kosmetyki" },
      metrics: [{ label: { en: "orders a month", pl: "zamówień miesięcznie" }, value: 1200 }, { label: "", value: "x" }],
      links: [{ label: "Shop", url: "https://www.sklep-a.example/sklep" }, { label: "Plain", url: "http://insecure.example" }],
    },
    { name: "No https", url: "http://sklep-b.example" },
    { url: "https://no-name.example" },
    { name: "Bad description", url: "https://c.example", description: 42 },
    "nonsense",
    null,
  ])
  assert.equal(refs.length, 2)
  assert.deepEqual(refs[0], {
    name: "Sklep A",
    url: "https://www.sklep-a.example/",
    soon: false,
    description: { en: "Cosmetics", pl: "Kosmetyki" },
    metrics: [{ label: { en: "orders a month", pl: "zamówień miesięcznie" }, value: "1200" }],
    links: [{ label: "Shop", url: "https://www.sklep-a.example/sklep" }],
  })
  assert.deepEqual(refs[1], { name: "Bad description", url: "https://c.example/", soon: false, metrics: [], links: [] })
  assert.deepEqual(normalizeReferences(undefined), [])
  assert.deepEqual(normalizeReferences({ name: "x" }), [])
  assert.deepEqual(localized({ pl: "Tylko po polsku" }), { pl: "Tylko po polsku" })
  assert.equal(localized({ en: "", pl: " " }), null)
})

test("references: a store that starts soon needs only its name, a live one still needs an https URL", () => {
  const refs = normalizeReferences([
    { name: "Soon, no address", soon: true, description: "Opens in spring" },
    { name: "Soon, with an address", soon: true, url: "https://soon.example.com" },
    { name: "Soon, insecure address", soon: true, url: "http://soon.example.com" },
    { name: "Live, no address" },
    { name: "Live, insecure address", url: "http://live.example.com" },
    { name: "Not a boolean", soon: "yes" },
    { soon: true },
  ])
  assert.deepEqual(refs[0], { name: "Soon, no address", url: null, soon: true, description: "Opens in spring", metrics: [], links: [] })
  assert.deepEqual(
    refs.map((r) => ({ name: r.name, soon: r.soon, url: r.url })),
    [
      { name: "Soon, no address", soon: true, url: null },
      { name: "Soon, with an address", soon: true, url: "https://soon.example.com/" },
      { name: "Soon, insecure address", soon: true, url: null },
    ],
  )
  assert.equal(normalizeReferences(Array.from({ length: 15 }, (_, i) => ({ name: `Store ${i}`, soon: true }))).length, 12)
  assert.deepEqual(resolveOptions({ references: [{ name: "Soon", soon: true }] }).references.map((r) => r.soon), [true])
})

test("references: the since date of an older config is ignored, never an error", () => {
  const refs = normalizeReferences([
    { name: "Live", url: "https://a.pl", since: "2026-04" },
    { name: "Soon", soon: true, since: { not: "a month" } },
  ])
  assert.deepEqual(refs, [
    { name: "Live", url: "https://a.pl/", soon: false, metrics: [], links: [] },
    { name: "Soon", url: null, soon: true, metrics: [], links: [] },
  ])
})

test("references: a review needs a positive rating and a source, never exceeds its scale, links only over https", () => {
  const review = normalizeReview({ rating: "4,8", source: "Clutch", url: "https://clutch.co/review/1", icon: "javascript:alert(1)", quote: { pl: "Polecam" } })
  assert.deepEqual(review, { rating: 4.8, scale: 5, source: "Clutch", url: "https://clutch.co/review/1", icon: null, quote: { pl: "Polecam" }, author: null })
  assert.equal(normalizeReview({ rating: 9, source: "Clutch" })?.rating, 5)
  assert.equal(normalizeReview({ rating: 9, scale: 10, source: "Google" })?.scale, 10)
  assert.equal(normalizeReview({ rating: 5, source: "Clutch", url: "http://clutch.co" })?.url, null)
  assert.equal(normalizeReview({ rating: 0, source: "Clutch" }), null)
  assert.equal(normalizeReview({ rating: 5 }), null)
  assert.equal(normalizeReview("5 stars"), null)
  const [withReview, without] = normalizeReferences([
    { name: "A", url: "https://a.pl", review: { rating: 5, source: "Clutch" } },
    { name: "B", url: "https://b.pl", review: { rating: "great" } },
  ])
  assert.equal(withReview.review?.rating, 5)
  // Like every other optional part of a reference, a missing or invalid review is left out.
  assert.equal("review" in without, false)
})

test("0.2.0 options: safe defaults, normalized values", () => {
  const o = resolveOptions({})
  assert.equal(o.productSyncEnabled, true)
  assert.equal(o.priceTarget, "variant")
  assert.equal(o.priceType, "gross")
  assert.equal(o.priceCurrency, "pln")
  assert.equal(o.priceWriter, false)
  assert.equal(o.createMissingProducts, false)
  assert.equal(o.createContractors, false)
  assert.equal(o.salesDocument, "none")
  assert.equal(o.salesDocumentAfter, "wz")
  assert.equal(o.maxPriceChangesPerRun, 200)
  assert.equal(o.maxProductsPerRun, 20)
  assert.deepEqual(o.nipSources, [...DEFAULT_NIP_SOURCES])
  assert.deepEqual(o.references, [])

  const custom = resolveOptions({
    priceTarget: "price_list",
    priceListId: " plist_01J ",
    priceType: "net",
    priceCurrency: "EUR",
    salesDocument: "PA" as never,
    salesDocumentAfter: "zk",
    maxPriceChangesPerRun: 0,
    maxProductsPerRun: 99999,
    nipSources: "metadata.nip, billing_address.company" as never,
    taxIdMetadataKeys: ["vat"],
  })
  assert.equal(custom.priceListId, "plist_01J")
  assert.equal(custom.priceCurrency, "eur")
  assert.equal(custom.salesDocument, "pa")
  assert.equal(custom.salesDocumentAfter, "zk")
  assert.equal(custom.maxPriceChangesPerRun, 200)
  assert.equal(custom.maxProductsPerRun, 500)
  assert.deepEqual(custom.nipSources, ["metadata.nip", "billing_address.company"])

  // Without nipSources, a custom taxIdMetadataKeys drives the NIP search too.
  assert.deepEqual(resolveOptions({ taxIdMetadataKeys: ["vat"] }).nipSources, ["metadata.vat", "billing_address.metadata.vat", "billing_address.company"])
  assert.deepEqual(optionWarnings(resolveOptions({ priceTarget: "price_list" })), ["priceListId"])
  assert.deepEqual(optionWarnings(o), [])
})
