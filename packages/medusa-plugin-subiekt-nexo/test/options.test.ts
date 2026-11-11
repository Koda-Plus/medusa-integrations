import { test } from "node:test"
import assert from "node:assert/strict"
import { optionWarnings, resolveOptions } from "../src/modules/subiekt/lib/options.ts"
import { DEFAULT_NIP_SOURCES } from "../src/modules/subiekt/lib/constants.ts"

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
