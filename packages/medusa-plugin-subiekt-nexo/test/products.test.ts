import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { currentPrice, gramsFromKg, handleFor, nextQuarantine, planCatalog, resolvePriceLevel, type CatalogVariant } from "../src/modules/subiekt/lib/products.ts"
import type { ProductsPage } from "../src/modules/subiekt/lib/contract.ts"

const page = JSON.parse(readFileSync(new URL("../contract/examples/products.response.json", import.meta.url), "utf8")) as ProductsPage
const opts = { target: "variant" as const, priceListId: null, level: "", type: "gross" as const, currency: "pln" }

const variant = (id: string, sku: string | null, codes: Array<string | null>, prices: CatalogVariant["prices"] = []): CatalogVariant => ({
  id,
  productId: `prod_${id}`,
  sku,
  codes,
  title: null,
  productTitle: `Produkt ${id}`,
  prices,
})
const price = (id: string, amount: number, extra: Partial<CatalogVariant["prices"][number]> = {}) => ({ id, amount, currency: "pln", priceListId: null, rulesCount: 0, ...extra })

test("the configured price level is found by symbol, then by name; the first one by default", () => {
  assert.equal(resolvePriceLevel(page.price_levels, "")?.symbol, "DETAL")
  assert.equal(resolvePriceLevel(page.price_levels, "hurt")?.symbol, "HURT")
  assert.equal(resolvePriceLevel(page.price_levels, "Hurtowa")?.symbol, "HURT")
  assert.equal(resolvePriceLevel(page.price_levels, "VIP"), null)
})

test("EAN first, then SKU against the symbol; equal prices are left alone, others planned from and to", () => {
  const plan = planCatalog(
    page.items,
    [
      variant("v1", "OLD-SKU", ["5901234123457"], [price("p1", 79.9)]),
      variant("v2", "TN-200", [null], [price("p2", 55)]),
      variant("v3", "NOT-IN-SUBIEKT", [], [price("p3", 10)]),
    ],
    opts,
    page.price_levels,
  )
  assert.equal(plan.blocked, null)
  assert.deepEqual(
    plan.prices.map((p) => [p.symbol, p.variantId, p.from, p.to, p.matchedBy, p.priceId]),
    [["KR-050", "v1", 79.9, 89.9, "ean", "p1"]],
  )
  assert.equal(plan.stats.unchanged, 1)
  assert.equal(plan.stats.matchedByEan, 1)
  assert.equal(plan.stats.matchedBySku, 1)
  assert.deepEqual(plan.samples.unmatchedVariants, ["NOT-IN-SUBIEKT"])
})

test("net prices, a price list target, and a variant without a price yet", () => {
  const net = planCatalog(page.items, [variant("v1", "KR-050", [], [price("p1", 89.9)])], { ...opts, type: "net" }, page.price_levels)
  assert.equal(net.prices[0].to, 73.09)

  const list = planCatalog(
    page.items,
    [variant("v1", "KR-050", [], [price("p1", 89.9), price("pl1", 70, { priceListId: "plist_1" })])],
    { ...opts, target: "price_list", priceListId: "plist_1", level: "HURT" },
    page.price_levels,
  )
  assert.deepEqual([list.prices[0].from, list.prices[0].to, list.prices[0].priceId], [70, 71.92, "pl1"])

  const none = planCatalog(page.items, [variant("v1", "KR-050", [])], opts, page.price_levels)
  assert.deepEqual([none.prices[0].from, none.prices[0].priceId], [null, null])
})

test("the variant price ignores region rules, quantity tiers and price lists", () => {
  const v = variant("v1", "KR-050", [], [
    price("rule", 10, { rulesCount: 1 }),
    price("tier", 11, { minQuantity: 10 }),
    price("list", 12, { priceListId: "plist_1" }),
    price("eur", 13, { currency: "eur" }),
    price("base", 14),
  ])
  assert.equal(currentPrice(v, opts)?.id, "base")
})

test("a duplicated EAN in Subiekt is reported and never guessed; the SKU may still match", () => {
  const items = [
    { ...page.items[0], symbol: "A", ean: "5901234123457" },
    { ...page.items[0], symbol: "B", ean: "5901234123457" },
  ]
  const plan = planCatalog(items, [variant("v1", null, ["5901234123457"]), variant("v2", "B", ["5901234123457"])], opts, page.price_levels)
  assert.equal(plan.stats.conflicts, 1)
  assert.deepEqual(plan.prices.map((p) => [p.variantId, p.symbol, p.matchedBy]), [["v2", "B", "sku"]])
  assert.equal(plan.creates.length, 0)
})

test("Subiekt products missing in Medusa become draft candidates only when meant for the shop, priced and not kits", () => {
  const items = [
    ...page.items,
    { ...page.items[0], symbol: "KIT-1", ean: null, kind: "kit" as const },
    { ...page.items[0], symbol: "SVC-1", ean: null, kind: "service" as const, name: "Pakowanie na prezent" },
  ]
  const plan = planCatalog(items, [], opts, page.price_levels)
  assert.deepEqual(
    plan.creates.map((c) => [c.symbol, c.to, c.manageInventory]),
    [
      ["KR-050", 89.9, true],
      ["SVC-1", 89.9, false],
      ["TN-200", 55, true],
    ],
  )
  assert.equal(plan.stats.inactive, 1)
  assert.equal(plan.stats.skippedKits, 1)
})

test("a level in another currency plans nothing; an unknown level plans nothing", () => {
  const eur = planCatalog(page.items, [variant("v1", "KR-050", [])], { ...opts, currency: "eur" }, page.price_levels)
  assert.equal(eur.blocked, "currency_mismatch")
  assert.equal(eur.prices.length + eur.creates.length, 0)
  assert.equal(planCatalog(page.items, [], { ...opts, level: "VIP" }, page.price_levels).blocked, "no_level")
})

test("helpers: grams, handles with Polish letters, quarantine counting", () => {
  assert.equal(gramsFromKg(0.08), 80)
  assert.equal(gramsFromKg(null), undefined)
  assert.equal(handleFor("Tonik łagodzący 200 ml", "TN-200"), "tonik-lagodzacy-200-ml-tn-200")
  assert.deepEqual(nextQuarantine(0, "failed", 3), { failures: 1, quarantined: false })
  assert.deepEqual(nextQuarantine(2, "failed", 3), { failures: 3, quarantined: true })
  assert.deepEqual(nextQuarantine(2, "applied", 3), { failures: 0, quarantined: false })
  assert.deepEqual(nextQuarantine(1, "stale", 3), { failures: 1, quarantined: false })
})
