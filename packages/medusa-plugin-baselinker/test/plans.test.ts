import { test } from "node:test"
import assert from "node:assert/strict"
import { addCardParams, planCards, updateCardParams, type CardPlanVariant } from "../src/modules/baselinker/lib/card-plan.ts"
import { planPricePush, priceGroupProblem, pricePayload } from "../src/modules/baselinker/lib/price-push.ts"
import { afterFailure, afterSuccess, isQuarantined, selectForApply } from "../src/modules/baselinker/lib/quarantine.ts"
import { planStockPush, stockPayload } from "../src/modules/baselinker/lib/stock-push.ts"

const v = (id: string, over: Partial<CardPlanVariant> = {}): CardPlanVariant => ({
  id,
  productId: `prod_${id}`,
  sku: id.toUpperCase(),
  ean: null,
  name: `Produkt ${id}`,
  description: null,
  images: [],
  weightKg: null,
  price: null,
  available: null,
  ...over,
})

test("cards: an incomplete read plans nothing (a missing card would be created twice)", () => {
  assert.equal(planCards({ complete: false, variants: [v("a")], cards: [] }).skipped, "incomplete_read")
})

test("cards: create for a variant without a card, update for a linked one, conflicts never create", () => {
  const plan = planCards({
    complete: true,
    variants: [
      v("a", { ean: "5901234123457", price: 99, available: 3, images: ["https://cdn.example.com/a.jpg", "ftp://x"] }),
      v("b", { name: "Nowa nazwa" }),
      v("c"),
      v("d", { ean: "5900000000017" }),
      v("e", { sku: null }),
      v("f", { sku: "DUP" }),
      v("g", { sku: "dup" }),
    ],
    cards: [
      { blProductId: "10", sku: "B", ean: null, name: "Stara nazwa", variantId: "b", conflict: null },
      { blProductId: "11", sku: "c", ean: null, name: "C", variantId: null, conflict: "duplicate_sku" },
      { blProductId: "12", sku: "OTHER", ean: "5900000000017", name: "D", variantId: null, conflict: null },
    ],
  })
  const by = new Map(plan.items.map((i) => [i.variantId, i]))
  assert.equal(by.get("b")?.action, "update")
  assert.deepEqual(by.get("b")?.update, { blProductId: "10", name: "Nowa nazwa" })
  assert.equal(by.get("a")?.action, "create")
  assert.deepEqual(by.get("a")?.create?.images, ["https://cdn.example.com/a.jpg"])
  assert.equal(by.get("c")?.reason, "sku_on_card")
  assert.equal(by.get("d")?.reason, "ean_on_other_card")
  assert.equal(by.get("e")?.reason, "no_sku")
  assert.equal(by.get("f")?.reason, "duplicate_variant_sku")
  assert.equal(plan.items[0].action, "update", "updates first")
  assert.deepEqual(plan.stats, { variants: 7, create: 1, update: 1, unchanged: 0, skip: 1, conflict: 4 })

  const params = addCardParams(by.get("a")!.create!, { inventoryId: 9, priceGroupId: 105, warehouseId: "bl_1" })
  assert.deepEqual(params, {
    inventory_id: 9,
    sku: "A",
    text_fields: { name: "Produkt a" },
    ean: "5901234123457",
    prices: { "105": 99 },
    stock: { bl_1: 3 },
    images: { "0": "url:https://cdn.example.com/a.jpg" },
  })
  assert.deepEqual(updateCardParams({ blProductId: "10", ean: "5901234123457" }, 9), { inventory_id: 9, product_id: 10, ean: "5901234123457" })
})

test("price group guard: only an existing standard group in the Medusa currency is written", () => {
  const groups = [
    { id: 7, name: "Detal", currency: "PLN", derived: false },
    { id: 8, name: "Allegro", currency: "PLN", derived: true },
    { id: 9, name: "Detal EUR", currency: "EUR", derived: false },
  ]
  assert.equal(priceGroupProblem(groups, 7, "pln"), null)
  assert.match(String(priceGroupProblem(groups, 8, "pln")), /derived/)
  assert.match(String(priceGroupProblem(groups, 9, "pln")), /EUR/)
  assert.match(String(priceGroupProblem(groups, 5, "pln")), /not on this account/)
})

test("cards: a SKU longer than BaseLinker keeps is skipped, never sent cut (it could not be matched back)", () => {
  const long = `SKU-${"X".repeat(47)}`
  const plan = planCards({ complete: true, variants: [v("a", { sku: long }), v("b", { sku: "X".repeat(50) })], cards: [] })
  const by = new Map(plan.items.map((i) => [i.variantId, i]))
  assert.equal(by.get("a")?.action, "skip")
  assert.equal(by.get("a")?.reason, "sku_too_long")
  assert.equal(by.get("b")?.action, "create", "50 characters fit")
  assert.equal(by.get("b")?.create?.sku, "X".repeat(50))
})

test("stock push: available = stocked minus reserved, decreases first, unknown is never zero", () => {
  const plan = planStockPush({
    complete: true,
    cards: [
      { blProductId: "1", variantId: "a", conflict: null, stock: 10 },
      { blProductId: "2", variantId: "b", conflict: null, stock: 0 },
      { blProductId: "3", variantId: "c", conflict: null, stock: 4 },
      { blProductId: "4", variantId: "d", conflict: null, stock: 1 },
      { blProductId: "5", variantId: "e", conflict: "duplicate_sku", stock: 9 },
      { blProductId: "6", variantId: "f", conflict: null, stock: null },
    ],
    variants: [
      { id: "a", productId: null, sku: "A", productTitle: null, manageInventory: true, inventoryItems: [{ inventoryItemId: "ia", requiredQuantity: 1 }] },
      { id: "b", productId: null, sku: "B", productTitle: null, manageInventory: true, inventoryItems: [{ inventoryItemId: "ib", requiredQuantity: 1 }] },
      { id: "c", productId: null, sku: "C", productTitle: null, manageInventory: true, inventoryItems: [{ inventoryItemId: "ic", requiredQuantity: 2 }] },
      { id: "d", productId: null, sku: "D", productTitle: null, manageInventory: true, inventoryItems: [{ inventoryItemId: "missing", requiredQuantity: 1 }] },
      { id: "e", productId: null, sku: "E", productTitle: null, manageInventory: true, inventoryItems: [{ inventoryItemId: "ie", requiredQuantity: 1 }] },
      { id: "f", productId: null, sku: "F", productTitle: null, manageInventory: true, inventoryItems: [{ inventoryItemId: "if", requiredQuantity: 1 }] },
    ],
    levels: [
      { inventoryItemId: "ia", stockedQuantity: 6, reservedQuantity: 2 },
      { inventoryItemId: "ib", stockedQuantity: 3, reservedQuantity: 5 },
      { inventoryItemId: "ic", stockedQuantity: 9, reservedQuantity: 0 },
      { inventoryItemId: "if", stockedQuantity: 2, reservedQuantity: 0 },
    ],
  })
  assert.deepEqual(
    plan.changes.map((c) => [c.blProductId, c.from, c.to]),
    [
      ["1", 10, 4],
      ["6", null, 2],
    ],
  )
  assert.equal(plan.stats.kitsSkipped, 1)
  assert.equal(plan.stats.noLevel, 1, "a variant without a level is unknown, not zero")
  assert.equal(plan.stats.unchanged, 1, "reserved above stocked is zero, and BaseLinker has zero")
  assert.deepEqual(stockPayload(plan.changes, "bl_1"), { "1": { bl_1: 4 }, "6": { bl_1: 2 } })
  assert.equal(planStockPush({ complete: false, cards: [], variants: [], levels: [] }).skipped, "incomplete_read")
})

test("price push: base price to the group, net prices with the card's VAT rate, no rate no change", () => {
  const input = {
    complete: true,
    priceGroupId: 105,
    cards: [
      { blProductId: "1", variantId: "a", conflict: null, prices: { "105": 120 } },
      { blProductId: "2", variantId: "b", conflict: null, prices: { "105": 50 } },
      { blProductId: "3", variantId: "c", conflict: null, prices: null },
      { blProductId: "4", variantId: "d", conflict: null, prices: { "105": 10 } },
    ],
    variants: [
      { id: "a", productId: null, sku: "A", label: "A", price: 100 },
      { id: "b", productId: null, sku: "B", label: "B", price: 50 },
      { id: "c", productId: null, sku: "C", label: "C", price: 7 },
      { id: "d", productId: null, sku: "D", label: "D", price: null },
    ],
  }
  const gross = planPricePush({ ...input, taxInclusive: true })
  assert.deepEqual(
    gross.changes.map((c) => [c.blProductId, c.from, c.to]),
    [
      ["1", 120, 100],
      ["3", null, 7],
    ],
  )
  assert.equal(gross.stats.noPrice, 1)
  const net = planPricePush({ ...input, taxInclusive: false, rates: new Map([["1", 23], ["2", 23], ["3", null]]) })
  assert.deepEqual(
    net.changes.map((c) => [c.blProductId, c.to]),
    [
      ["1", 123],
      ["2", 61.5],
    ],
    "50 net is 61.50 gross: the card at 50 changes",
  )
  assert.equal(net.stats.noRate, 1)
  assert.deepEqual(pricePayload(net.changes, 105), { "1": { "105": 123 }, "2": { "105": 61.5 } })
})

test("quarantine: counted per item, quarantined at the threshold, reset by a success; the cap after the quarantine", () => {
  const now = new Date("2026-10-06T10:00:00Z")
  let s = afterFailure(null, 3, now)
  assert.deepEqual(s, { failures: 1, quarantinedAt: null })
  s = afterFailure(s, 3, now)
  s = afterFailure(s, 3, now)
  assert.equal(isQuarantined(s), true)
  assert.deepEqual(afterSuccess(s), { failures: 0, quarantinedAt: null })
  assert.equal(afterSuccess({ failures: 0, quarantinedAt: null }), null)
  const sel = selectForApply(["a", "b", "c", "d"], (x) => x, new Set(["b"]), 2)
  assert.deepEqual(sel, { apply: ["a", "c"], overCap: ["d"], quarantined: ["b"] })
})
