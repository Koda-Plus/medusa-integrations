import { test } from "node:test"
import assert from "node:assert/strict"
import { availableFor, isStockIssue, stockState } from "../src/modules/allegro/lib/stock.ts"

test("available: stocked minus reserved, summed over locations, filtered when asked", () => {
  const v = {
    id: "v1",
    manageInventory: true,
    items: [
      {
        requiredQuantity: 1,
        levels: [
          { locationId: "sloc_a", stocked: 10, reserved: 3 },
          { locationId: "sloc_b", stocked: 4, reserved: 0 },
        ],
      },
    ],
  }
  assert.equal(availableFor(v, null), 11)
  assert.equal(availableFor(v, ["sloc_b"]), 4)
  assert.equal(availableFor(v, ["sloc_x"]), 0)
})

test("available: not tracked is null, a kit has as many as its scarcest part, never negative", () => {
  assert.equal(availableFor({ id: "v", manageInventory: false, items: [] }, null), null)
  assert.equal(availableFor({ id: "v", manageInventory: true, items: [] }, null), null)
  const kit = {
    id: "kit",
    manageInventory: true,
    items: [
      { requiredQuantity: 2, levels: [{ locationId: "a", stocked: 9, reserved: 0 }] },
      { requiredQuantity: 1, levels: [{ locationId: "a", stocked: 3, reserved: 0 }] },
    ],
  }
  assert.equal(availableFor(kit, null), 3)
  assert.equal(availableFor({ id: "n", manageInventory: true, items: [{ requiredQuantity: 1, levels: [{ locationId: "a", stocked: 1, reserved: 4 }] }] }, null), 0)
})

test("labels of live offers", () => {
  assert.equal(stockState({ status: "ACTIVE", allegro: 5, medusa: 2 }), "oversell")
  assert.equal(stockState({ status: "ACTIVE", allegro: 1, medusa: 0 }), "sold_out")
  assert.equal(stockState({ status: "ACTIVE", allegro: 1, medusa: 4 }), "under_listed")
  assert.equal(stockState({ status: "ACTIVE", allegro: 3, medusa: 3 }), "ok")
  assert.equal(stockState({ status: "ACTIVATING", allegro: 3, medusa: 1 }), "oversell")
  assert.equal(stockState({ status: "ACTIVE", allegro: null, medusa: 3 }), "unknown")
  assert.equal(stockState({ status: "ACTIVE", allegro: 3, medusa: null }), "untracked")
})

test("labels of ended offers and drafts", () => {
  assert.equal(stockState({ status: "ENDED", allegro: 0, medusa: 2 }), "ended_in_stock")
  assert.equal(stockState({ status: "ENDED", allegro: 0, medusa: 0 }), null)
  assert.equal(stockState({ status: "INACTIVE", allegro: 4, medusa: 0 }), null)
})

test("only oversell and sold out are issues", () => {
  assert.equal(isStockIssue("oversell"), true)
  assert.equal(isStockIssue("sold_out"), true)
  for (const s of ["under_listed", "ended_in_stock", "ok", "untracked", "unknown", null]) assert.equal(isStockIssue(s), false)
})
