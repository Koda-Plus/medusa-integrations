import { test } from "node:test"
import assert from "node:assert/strict"
import { toAccount, toTx } from "../src/modules/loyalty/lib/store.ts"

test("store: an account maps with metadata parsing and a non-negative balance", () => {
  const dto = toAccount({
    id: "lac_1",
    customer_id: "cus_1",
    customer_email: "a@example.com",
    customer_name: " Firma ",
    balance: -10,
    total_earned: 1500,
    total_redeemed: 500,
    tier_multiplier: 2,
    metadata: JSON.stringify({ redeemed: [{ name: "Rabat 250 zł", pts: 1500 }], total_saved_pln: 250 }),
    demo: true,
  })
  assert.equal(dto.customer_name, "Firma")
  assert.equal(dto.balance, 0)
  assert.equal(dto.total_earned, 1500)
  assert.equal(dto.tier_multiplier, 2)
  assert.deepEqual(dto.redeemed, [{ name: "Rabat 250 zł", pts: 1500 }])
  assert.equal(dto.total_saved, 250)
  assert.equal(dto.demo, true)
})

test("store: metadata in object form and broken values read their defaults", () => {
  const dto = toAccount({ id: "lac_2", customer_id: "cus_2", metadata: { redeemed: [{ name: "A", pts: 12 }, { broken: true }] } })
  assert.deepEqual(dto.redeemed, [{ name: "A", pts: 12 }])
  assert.equal(dto.balance, 0)
  assert.equal(toAccount({ id: "lac_3", tier_multiplier: 0 }).tier_multiplier, 1)
})

test("store: a transaction maps its kind and falls back on earn_order", () => {
  const t = toTx({ id: "ltx_1", account_id: "lac_1", delta: -100, kind: "redeem", reason: "x", order_id: null, created_at: new Date("2026-01-01T00:00:00Z") })
  assert.equal(t.kind, "redeem")
  assert.equal(t.delta, -100)
  assert.equal(t.created_at, "2026-01-01T00:00:00.000Z")
  assert.equal(toTx({ id: "ltx_2", kind: "cos" }).kind, "earn_order")
})
