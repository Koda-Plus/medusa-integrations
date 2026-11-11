import { test } from "node:test"
import assert from "node:assert/strict"
import { cleanPromo, functionError, planBid, promoBatches, promoRefused, readCategoryBids, readCategoryTop, readProductBids, readTopOffers, standing, toGrosze } from "../src/modules/ceneo/lib/cpc.ts"
import { DEMO_SHOP, bidsParam, demoCeneoId, demoCpcTransport, resetDemoCpc } from "../src/modules/ceneo/lib/cpc-transport.ts"

test("money: bids in grosze, from numbers and Ceneo's strings", () => {
  assert.equal(toGrosze("0.2500"), 25)
  assert.equal(toGrosze(1.22), 122)
  assert.equal(toGrosze("0,51"), 51)
  assert.equal(toGrosze("-1"), null)
  assert.equal(toGrosze("abc"), null)
})

test("plan: never above maxBid, a limited step per run, flagged below the minimum", () => {
  const base = { maxBid: 100, maxChangePercent: 50, minSuggested: 20 }
  assert.deepEqual(planBid({ ...base, current: 40, target: 50 }), { next: 50, reasons: [], done: false })
  assert.deepEqual(planBid({ ...base, current: 40, target: 300 }), { next: 60, reasons: ["clamped_max", "clamped_step"], done: false })
  assert.deepEqual(planBid({ ...base, current: 60, target: 300 }), { next: 90, reasons: ["clamped_max", "clamped_step"], done: false })
  assert.deepEqual(planBid({ ...base, current: 100, target: 300 }), { next: null, reasons: ["clamped_max"], done: true })
  assert.deepEqual(planBid({ ...base, current: 40, target: 10 }), { next: 20, reasons: ["clamped_step"], done: false })
  assert.deepEqual(planBid({ ...base, current: 0, target: 30 }), { next: 30, reasons: [], done: false })
  assert.deepEqual(planBid({ ...base, current: null, target: 10 }), { next: 10, reasons: ["below_min"], done: false })
  assert.deepEqual(planBid({ ...base, current: 40, target: 0 }), { next: 0, reasons: [], done: false })
  assert.deepEqual(planBid({ ...base, current: 40, target: null }), { next: null, reasons: [], done: true })
  /* Above the ceiling (set in Panel Ceneo, or maxBid lowered): down to maxBid at once, the step never keeps it above. */
  assert.deepEqual(planBid({ ...base, current: 500, target: 50 }).next, 100)
  assert.deepEqual(planBid({ ...base, current: 500, target: 300 }).next, 100)
  /* A negative target never becomes a bid. */
  assert.equal(planBid({ ...base, current: 40, target: -5 }).next, 0)
  /* Small bids move by at least 1 gr. */
  assert.equal(planBid({ ...base, maxChangePercent: 10, current: 5, target: 9 }).next, 6)
  assert.equal(planBid({ ...base, maxChangePercent: 10, current: 5, target: 1 }).next, 4)
  assert.deepEqual(planBid({ ...base, current: 30, target: 30 }), { next: null, reasons: [], done: true })
})

const BIDS = { Response: { Status: "OK", Result: { bids: { bid: [{ ProductId: 73627581, ProductName: "Mata", ClickRate: "0.18", MaxBid: "0.20", ClickRateWithMaxBid: "0.3800", ShopProductId: "item100" }, { ProductId: 1, MaxBid: "0.30" }] } } } }

test("reading bids, category bids, the top 10 and the category top", () => {
  assert.deepEqual(readProductBids(BIDS), [{ key: "item100", ceneoProductId: "73627581", name: "Mata", bid: 20, clickRate: 18, clickRateWithMaxBid: 38 }])
  assert.equal(readProductBids({ Result: { bids: { bid: { ShopProductId: "one", MaxBid: "0.10" } } } })[0].bid, 10)
  assert.deepEqual(readCategoryBids({ Response: { Status: "OK", Result: { bids: { bid: [{ CategoryId: "2111", CategoryName: "Opony letnie", MaxBid: "1.2200" }] } } } }), [{ key: "2111", ceneoProductId: null, name: "Opony letnie", bid: 122, clickRate: null, clickRateWithMaxBid: null }])
  const top = readTopOffers({ Response: { Status: "OK", Result: { product_offers_by_ids: { product_offers_by_id: [{ CeneoProdID: "1", ShopProdID: "item100", OffersNumber: "2", MinSuggestedBid: "0.51", offers: [{ CustName: "b.pl", Price: "60", Position: "2" }, { CustName: "mojsklep.pl", Price: "54.9900", OnStock: "3", Position: "1", ReviewsNumber: "2133", SuggestedOffer: "false", MinimalDeliveryCost: 7.9 }] }] } } } })
  assert.equal(top[0].minSuggestedBid, 51)
  assert.equal(top[0].offers[0].shop, "mojsklep.pl")
  assert.deepEqual(standing(top[0].offers, "MojSklep.pl"), { position: 1, lowest: 54.99, count: 2 })
  assert.deepEqual(standing(top[0].offers, null), { position: null, lowest: 54.99, count: 2 })
  assert.equal(readCategoryTop([{ Id: 85615943, Name: "iPhone", IsProductBidByMe: false, IsProductSoldByMe: true, MyProductId: "P1", MyPrice: 2999 }])[0].myProductId, "P1")
  assert.equal(functionError({ Response: { Status: "OK" } }), null)
  assert.match(functionError({ Response: { Status: "Error", Message: "bad key" } }) ?? "", /Error: bad key/)
  assert.deepEqual(promoRefused([{ ShopProductId: "a", IsSet: true }, { ShopProductId: "b", IsSet: false }], "ShopProductId", "IsSet"), ["b"])
})

test("bids parameter: the Swagger example shape", () => {
  assert.equal(bidsParam([{ id: "1", bid: 25 }, { id: "2", bid: 30 }], "CeneoProductId"), '[{"CeneoProductId":1,"MaxBid":0.25},{"CeneoProductId":2,"MaxBid":0.3}]')
  assert.equal(bidsParam([{ id: "2111", bid: 122 }], "CategoryId"), '[{"CategoryId":2111,"MaxBid":1.22}]')
})

test("promotion texts: 30 characters, grouped by text, 20 per call", () => {
  assert.deepEqual(cleanPromo("  Darmowa   dostawa "), { ok: true, value: "Darmowa dostawa" })
  assert.deepEqual(cleanPromo(""), { ok: true, value: null })
  assert.deepEqual(cleanPromo("x".repeat(31)), { ok: false, reason: "too_long" })
  const rows = [...Array.from({ length: 25 }, (_, i) => ({ key: `p${i}`, promo: "A" })), { key: "q", promo: null }]
  const b = promoBatches(rows)
  assert.deepEqual(b.map((x) => [x.text, x.keys.length]), [["A", 20], ["A", 5], [null, 1]])
})

test("demo: bids written are read back, the store is in its own top 10", async () => {
  resetDemoCpc()
  const t = demoCpcTransport(new Map([["variant_a", 100], ["variant_b", 50]]))
  const [before] = await t.productBids(["variant_a"])
  await t.setProductBids([{ ceneoProductId: demoCeneoId("variant_a"), bid: 77 }])
  const [after] = await t.productBids(["variant_a"])
  assert.equal(after.bid, 77)
  assert.equal(before.ceneoProductId, after.ceneoProductId)
  const [top] = await t.topOffers(["variant_a"])
  assert.ok(top.offers.some((o) => o.shop === DEMO_SHOP && o.price === 100))
  assert.deepEqual(await t.productBids(["unknown"]), [])
  assert.deepEqual(await t.setPromo("product", ["variant_a"], "Promocja"), [])
})
