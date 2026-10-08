import { test } from "node:test"
import assert from "node:assert/strict"
import { windowOf } from "../src/modules/compliance/lib/prices.ts"

test("prices: the reference is the lowest price BEFORE today's, the floor is the lowest of the window", () => {
  const w = windowOf("KS-1", "pln", 549, [
    { sku: "KS-1", currency_code: "pln", amount: 549 },
    { sku: "KS-1", currency_code: "pln", amount: 615 },
  ])
  assert.equal(w.snapshots, 2)
  assert.equal(w.lowest_30d, 549)
  assert.equal(w.lowest_before, 615)
})

test("prices: a currency never sees the other currency's history", () => {
  const w = windowOf("KS-1", "pln", 549, [
    { sku: "KS-1", currency_code: "eur", amount: 128 },
    { sku: "KS-1", currency_code: "pln", amount: 615 },
    { sku: "KS-2", currency_code: "pln", amount: 999 },
  ])
  assert.equal(w.snapshots, 1)
  assert.equal(w.lowest_before, 615)
  assert.equal(w.lowest_30d, 549)
})

test("prices: no history, no reference", () => {
  const w = windowOf("KS-1", "pln", 549, [])
  assert.equal(w.lowest_30d, 549)
  assert.equal(w.lowest_before, null)
  assert.equal(w.snapshots, 0)
})

test("prices: snapshots at today's price give no reference (the boot capture)", () => {
  const w = windowOf("KS-1", "pln", 549, [{ sku: "KS-1", currency_code: "pln", amount: 549 }])
  assert.equal(w.lowest_before, null)
  assert.equal(w.snapshots, 1)
  assert.equal(w.lowest_30d, 549)
})
