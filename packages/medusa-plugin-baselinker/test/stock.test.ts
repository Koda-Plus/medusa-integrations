import { test } from "node:test"
import assert from "node:assert/strict"
import { planStock, stockTarget, type StockCard, type StockLevel, type StockVariant } from "../src/modules/baselinker/lib/stock.ts"

const LOC = "sloc_main"

const variant = (id: string, item: string | null, extra: Partial<StockVariant> = {}): StockVariant => ({
  id,
  productId: `prod_${id}`,
  sku: id.toUpperCase(),
  productTitle: `Product ${id}`,
  manageInventory: true,
  inventoryItems: item ? [{ inventoryItemId: item, requiredQuantity: 1 }] : [],
  ...extra,
})
const card = (id: string, variantId: string | null, stock: number | null, conflict: string | null = null): StockCard => ({ blProductId: id, variantId, stock, conflict })
const level = (item: string, stocked: number, reserved = 0): StockLevel => ({ id: `lvl_${item}`, inventoryItemId: item, stockedQuantity: stocked, reservedQuantity: reserved })

const base = { locationId: LOC, complete: true, mode: "plan" as const, maxChanges: 500 }

test("the rule: target stocked = max(0, BaseLinker) + reserved, so available equals BaseLinker", () => {
  assert.equal(stockTarget(5, 2), 7)
  assert.equal(stockTarget(-3, 1), 1)
  assert.equal(stockTarget(0, 0), 0)
  const plan = planStock({ ...base, cards: [card("1", "a", 4)], variants: [variant("a", "ii_a")], levels: [level("ii_a", 9, 2)] })
  assert.equal(plan.changes.length, 1)
  const c = plan.changes[0]
  assert.equal(c.target, 6)
  assert.equal(c.delta, -3)
  assert.equal(c.medusaStocked, 9)
  assert.equal(c.medusaReserved, 2)
  assert.equal(plan.stats.unitsRemoved, 3)
})

test("negative BaseLinker stock is clamped, and an equal level is no change", () => {
  const plan = planStock({
    ...base,
    cards: [card("1", "a", -1), card("2", "b", 3)],
    variants: [variant("a", "ii_a"), variant("b", "ii_b")],
    levels: [level("ii_a", 1, 1), level("ii_b", 4, 1)],
  })
  assert.equal(plan.changes.length, 0, "-1 with one reserved is stocked 1; 3 with one reserved is stocked 4")
  assert.equal(plan.stats.unchanged, 2)
  assert.equal(plan.stats.negativeClamped, 1)
})

test("kits, unmanaged variants, conflicts and unknown numbers are never touched", () => {
  const kit = variant("kit", null, {
    inventoryItems: [
      { inventoryItemId: "ii_x", requiredQuantity: 1 },
      { inventoryItemId: "ii_y", requiredQuantity: 1 },
    ],
  })
  const pack = variant("pack", null, { inventoryItems: [{ inventoryItemId: "ii_p", requiredQuantity: 2 }] })
  const plan = planStock({
    ...base,
    cards: [card("1", "kit", 5), card("2", "pack", 5), card("3", "free", 5), card("4", null, 5, "duplicate_sku"), card("5", "unknown", null)],
    variants: [kit, pack, variant("free", "ii_f", { manageInventory: false }), variant("unknown", "ii_u")],
    levels: [],
  })
  assert.equal(plan.changes.length, 0)
  assert.equal(plan.stats.kitsSkipped, 2)
  assert.deepEqual(plan.samples.kits, ["KIT", "PACK"])
  assert.equal(plan.stats.notManaged, 1)
  assert.equal(plan.stats.noStockNumber, 1)
})

test("plan mode writes nothing; write mode applies, creating missing levels", () => {
  const input = {
    ...base,
    cards: [card("1", "a", 2), card("2", "b", 3), card("3", "c", 0)],
    variants: [variant("a", "ii_a"), variant("b", "ii_b"), variant("c", "ii_c")],
    levels: [level("ii_a", 5)],
  }
  const plan = planStock(input)
  assert.equal(plan.changes.length, 2, "no level and zero stock is not worth a new level")
  assert.deepEqual([plan.create.length, plan.update.length], [0, 0])
  assert.ok(plan.changes.every((c) => !c.apply))

  const write = planStock({ ...input, mode: "write" })
  assert.deepEqual(write.update, [{ id: "lvl_ii_a", inventory_item_id: "ii_a", location_id: LOC, stocked_quantity: 2 }])
  assert.deepEqual(write.create, [{ inventory_item_id: "ii_b", location_id: LOC, stocked_quantity: 3 }])
  assert.equal(write.stats.toApply, 2)
})

test("the cap keeps decreases first and leaves the rest for the next run", () => {
  const plan = planStock({
    ...base,
    mode: "write",
    maxChanges: 2,
    cards: [card("1", "a", 9), card("2", "b", 0), card("3", "c", 1), card("4", "d", 8)],
    variants: [variant("a", "ii_a"), variant("b", "ii_b"), variant("c", "ii_c"), variant("d", "ii_d")],
    levels: [level("ii_a", 1), level("ii_b", 4), level("ii_c", 6), level("ii_d", 2)],
  })
  assert.deepEqual(
    plan.changes.map((c) => [c.sku, c.delta, c.apply]),
    [
      ["C", -5, true],
      ["B", -4, true],
      ["A", 8, false],
      ["D", 6, false],
    ],
  )
  assert.equal(plan.stats.overCap, 2)
})

test("an incomplete read plans and writes nothing", () => {
  const plan = planStock({ ...base, mode: "write", complete: false, cards: [card("1", "a", 0)], variants: [variant("a", "ii_a")], levels: [level("ii_a", 5)] })
  assert.equal(plan.skipped, "incomplete_read")
  assert.deepEqual([plan.changes.length, plan.create.length, plan.update.length], [0, 0, 0])
})

test("items missing from the read are never zeroed", () => {
  const plan = planStock({ ...base, mode: "write", cards: [], variants: [variant("a", "ii_a")], levels: [level("ii_a", 5)] })
  assert.equal(plan.changes.length, 0)
})

test("one inventory item claimed by two cards stays untouched", () => {
  const plan = planStock({
    ...base,
    cards: [card("1", "a", 1), card("2", "b", 7)],
    variants: [variant("a", "ii_shared"), variant("b", "ii_shared")],
    levels: [level("ii_shared", 3)],
  })
  assert.equal(plan.changes.length, 0)
  assert.equal(plan.stats.sharedItems, 2)
})
