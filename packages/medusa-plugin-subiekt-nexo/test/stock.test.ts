import { test } from "node:test"
import assert from "node:assert/strict"
import { planStockLevels, type StockVariant } from "../src/modules/subiekt/lib/stock.ts"
import type { StockItem } from "../src/modules/subiekt/lib/contract.ts"

const LOC = "sloc_main"
const opts = { locationId: LOC, field: "quantity" as const, stripSkuSuffixes: ["-WH"] }

const variant = (id: string, sku: string | null, codes: Array<string | null>, ii: string, extra: Partial<StockVariant> = {}): StockVariant => ({
  id,
  sku,
  codes,
  manageInventory: true,
  inventoryItems: [{ inventoryItemId: ii, requiredQuantity: 1, sku }],
  ...extra,
})

const stock: StockItem[] = [
  { symbol: "KR-050", ean: "5901234123457", name: "Krem", quantity: 37, available: 35 },
  { symbol: "TN-200", ean: null, name: "Tonik", quantity: 12, available: 11 },
  { symbol: "SR-030", ean: "5901234123471", name: "Serum", quantity: -2, available: -2 },
  { symbol: "ONLY-IN-SUBIEKT", ean: null, name: "Inny", quantity: 5, available: 5 },
]

test("EAN wins, SKU (without the wholesale suffix) is the fallback", () => {
  const plan = planStockLevels(
    stock,
    [
      variant("v1", "KREM-50-OLD-SKU", ["5901234123457"], "ii_1"),
      variant("v2", "TN-200-WH", [null], "ii_2"),
      variant("v3", "SR-030", ["5901234123471"], "ii_3"),
      variant("v4", "NOT-IN-SUBIEKT", [], "ii_4"),
    ],
    [
      { id: "lvl_1", inventoryItemId: "ii_1", stockedQuantity: 30 },
      { id: "lvl_2", inventoryItemId: "ii_2", stockedQuantity: 12 },
    ],
    opts,
  )
  assert.deepEqual(plan.update, [{ id: "lvl_1", inventory_item_id: "ii_1", location_id: LOC, stocked_quantity: 37 }])
  // Negative stock in Subiekt becomes 0, never a negative level.
  assert.deepEqual(plan.create, [{ inventory_item_id: "ii_3", location_id: LOC, stocked_quantity: 0 }])
  assert.equal(plan.stats.unchanged, 1)
  assert.equal(plan.stats.matchedByEan, 2)
  assert.equal(plan.stats.matchedBySku, 1)
  assert.deepEqual(plan.samples.unmatchedVariants, ["NOT-IN-SUBIEKT"])
  assert.deepEqual(plan.samples.unmatchedSubiekt, ["ONLY-IN-SUBIEKT"])
})

test("available instead of physical quantity when configured", () => {
  const plan = planStockLevels(stock, [variant("v1", "KR-050", [], "ii_1")], [], { ...opts, field: "available" })
  assert.equal(plan.create[0].stocked_quantity, 35)
})

test("a duplicated EAN in Subiekt is never guessed", () => {
  const dup: StockItem[] = [
    { symbol: "A", ean: "5901234123457", quantity: 1, available: 1 },
    { symbol: "B", ean: "5901234123457", quantity: 9, available: 9 },
  ]
  const plan = planStockLevels(dup, [variant("v1", null, ["5901234123457"], "ii_1")], [], opts)
  assert.equal(plan.create.length, 0)
  assert.equal(plan.stats.conflicts, 1)
  assert.match(plan.samples.conflicts[0], /5901234123457/)
})

test("one inventory item pulled towards two products with different stock stays untouched", () => {
  const plan = planStockLevels(stock, [variant("v1", "KR-050", [], "ii_shared"), variant("v2", "TN-200", [], "ii_shared")], [], opts)
  assert.equal(plan.create.length, 0)
  assert.equal(plan.update.length, 0)
  assert.equal(plan.stats.conflicts, 1)
})

test("kit components reach Subiekt by their own SKU, the kit itself is skipped", () => {
  const kit: StockVariant = {
    id: "v_kit",
    sku: "ZESTAW-1",
    codes: [],
    manageInventory: true,
    inventoryItems: [
      { inventoryItemId: "ii_krem", requiredQuantity: 1, sku: "KR-050" },
      { inventoryItemId: "ii_tonik", requiredQuantity: 2, sku: "TN-200" },
    ],
  }
  const plan = planStockLevels(stock, [kit], [], opts)
  assert.equal(plan.stats.skippedKits, 1)
  assert.deepEqual(
    plan.create.map((c) => [c.inventory_item_id, c.stocked_quantity]),
    [
      ["ii_krem", 37],
      ["ii_tonik", 12],
    ],
  )
})

test("variants that do not manage inventory are ignored", () => {
  const plan = planStockLevels(stock, [variant("v1", "KR-050", [], "ii_1", { manageInventory: false })], [], opts)
  assert.equal(plan.create.length + plan.update.length, 0)
})

test("products missing from the snapshot are never zeroed", () => {
  const plan = planStockLevels([], [variant("v1", "KR-050", [], "ii_1")], [{ id: "lvl_1", inventoryItemId: "ii_1", stockedQuantity: 8 }], opts)
  assert.equal(plan.update.length, 0)
  assert.equal(plan.create.length, 0)
})
