import { test } from "node:test"
import assert from "node:assert/strict"
import { advertsFromPartnerApi, compilePatterns, skuFromDescription } from "../src/modules/olx/lib/adverts.ts"
import { DEFAULT_SKU_PATTERNS } from "../src/modules/olx/lib/constants.ts"
import { buildDemoRawAdverts } from "../src/modules/olx/lib/demo.ts"
import { matchAdverts } from "../src/modules/olx/lib/matching.ts"

const patterns = compilePatterns(DEFAULT_SKU_PATTERNS)

test("SKU from the description: rest of the line, cut at a tag or two spaces", () => {
  assert.equal(skuFromDescription("Opony zimowe<br>Kod produktu: WZ-138 XD<br>Ilość sztuk: 4", patterns), "WZ-138 XD")
  assert.equal(skuFromDescription("Kod produktu: WZ-328/1  Ilość sztuk w komplecie: 4", patterns), "WZ-328/1")
  assert.equal(skuFromDescription("kod  produktu:   ks-tsm-5m\nnext", patterns), "ks-tsm-5m")
  assert.equal(skuFromDescription("Product code: AB-1", patterns), "AB-1")
  assert.equal(skuFromDescription("SKU: X1", patterns), "X1")
  assert.equal(skuFromDescription("No code here", patterns), null)
  assert.equal(skuFromDescription(null, patterns), null)
})

test("a broken custom pattern is ignored, not thrown", () => {
  const custom = compilePatterns(["(unclosed", "Ref:\\s*(\\S+)"])
  assert.equal(custom.length, 1)
  assert.equal(skuFromDescription("Ref: Z-9", custom), "Z-9")
})

test("Partner API items are parsed; items without id or url are counted but skipped", () => {
  const { adverts, statuses } = advertsFromPartnerApi(
    [
      {
        id: 1012345678,
        status: "active",
        url: "https://www.olx.pl/d/oferta/wkretarka-CID628-ID1bucWN.html",
        title: "Wkrętarka 18V",
        description: "<p>Kod produktu: KS-ELN-18V</p>",
        external_id: "",
        category_id: 1559,
        price: { value: 349.99, currency: "pln", negotiable: false },
        created_at: "2026-09-01 10:00:00",
        valid_to: "2026-10-01 10:00:00",
      },
      { id: 2, status: "limited", url: "", title: "no url" },
      { status: "outdated", url: "https://x" },
    ],
    patterns,
  )
  assert.equal(adverts.length, 1)
  assert.deepEqual(statuses, { active: 1, limited: 1, outdated: 1 })
  const a = adverts[0]
  assert.equal(a.olxId, "1012345678")
  assert.equal(a.externalId, null)
  assert.equal(a.descriptionSku, "KS-ELN-18V")
  assert.deepEqual(a.price, { value: 349.99, currency: "PLN" })
  assert.equal(a.createdAt, "2026-09-01T10:00:00.000Z")
  assert.equal(a.categoryId, 1559)
})

test("demo adverts are deterministic and exercise every bucket of the admin", () => {
  const catalog = [
    { sku: "KS-BHP-KSK", productTitle: "Kask", price: { value: 59, currency: "PLN" } },
    { sku: "KS-BHP-RKW", productTitle: "Rękawice", price: null },
    { sku: "KS-ELN-125", productTitle: "Szlifierka", price: { value: 299, currency: "PLN" } },
    { sku: "KS-ELN-18V", productTitle: "Wkrętarka", price: { value: 349, currency: "PLN" } },
    { sku: "KS-KLU-NAS", productTitle: "Klucze", price: { value: 189, currency: "PLN" } },
    { sku: "KS-MLT-CIE", productTitle: "Młotek", price: { value: 79, currency: "PLN" } },
    { sku: "KS-TSM-5M", productTitle: "Taśma", price: { value: 29, currency: "PLN" } },
    { sku: "KS-WKT-440", productTitle: "Wkręty", price: { value: 39, currency: "PLN" } },
  ]
  const ctx = { market: "pl", host: "www.olx.pl", now: new Date("2026-10-04T12:00:00Z") }
  const first = buildDemoRawAdverts(catalog, ctx)
  const second = buildDemoRawAdverts([...catalog].reverse(), ctx)
  assert.deepEqual(first, second, "same catalog, same adverts")

  const { adverts } = advertsFromPartnerApi(first, patterns)
  /* Five variants get an advert, three are kept back for publishing, plus four extra adverts. */
  assert.equal(adverts.length, 5 + 4)
  assert.equal(new Set(adverts.map((a) => a.olxId)).size, adverts.length, "unique ids")

  const { summary } = matchAdverts(
    adverts,
    catalog.map((c, i) => ({ id: `v${i}`, sku: c.sku, productId: `p${i}`, productTitle: c.productTitle })),
  )
  assert.equal(summary.unmatchedLive, 2)
  assert.equal(summary.noKey, 1)
  assert.ok(summary.bySource.external_id > 0 && summary.bySource.description > 0)
  assert.equal(summary.linkedVariants, 5)
  assert.equal(summary.linkedLive, 3, "one over the limit and one removed among the five")
})
