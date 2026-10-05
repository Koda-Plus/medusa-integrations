import { test } from "node:test"
import assert from "node:assert/strict"
import { localized, normalizeReferences } from "../src/modules/subiekt/lib/references.ts"
import { optionWarnings, resolveOptions } from "../src/modules/subiekt/lib/options.ts"
import { DEFAULT_NIP_SOURCES } from "../src/modules/subiekt/lib/constants.ts"

test("references are validated leniently: bad entries and fields are dropped, nothing throws", () => {
  const refs = normalizeReferences([
    {
      name: "Sklep A",
      url: "https://www.sklep-a.example",
      description: { en: "Cosmetics", pl: "Kosmetyki" },
      since: "2026-04",
      metrics: [{ label: { en: "orders a month", pl: "zamówień miesięcznie" }, value: 1200 }, { label: "", value: "x" }],
      links: [{ label: "Shop", url: "https://www.sklep-a.example/sklep" }, { label: "Plain", url: "http://insecure.example" }],
    },
    { name: "No https", url: "http://sklep-b.example" },
    { url: "https://no-name.example" },
    { name: "Bad since", url: "https://c.example", since: "April 2026", description: 42 },
    "nonsense",
    null,
  ])
  assert.equal(refs.length, 2)
  assert.deepEqual(refs[0], {
    name: "Sklep A",
    url: "https://www.sklep-a.example/",
    description: { en: "Cosmetics", pl: "Kosmetyki" },
    since: "2026-04",
    metrics: [{ label: { en: "orders a month", pl: "zamówień miesięcznie" }, value: "1200" }],
    links: [{ label: "Shop", url: "https://www.sklep-a.example/sklep" }],
  })
  assert.deepEqual(refs[1], { name: "Bad since", url: "https://c.example/", metrics: [], links: [] })
  assert.deepEqual(normalizeReferences(undefined), [])
  assert.deepEqual(normalizeReferences({ name: "x" }), [])
  assert.deepEqual(localized({ pl: "Tylko po polsku" }), { pl: "Tylko po polsku" })
  assert.equal(localized({ en: "", pl: " " }), null)
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
