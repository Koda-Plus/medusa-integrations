import { test } from "node:test"
import assert from "node:assert/strict"
import { toCreditOrder, toLimit } from "../src/modules/credit/lib/store.ts"

test("store: a limit maps with the remaining amount and the exhausted flag", () => {
  const dto = toLimit({ id: "crl_1", customer_id: "cus_1", customer_email: "a@example.com", customer_name: " Firma ", currency_code: "pln", limit_amount: 1000, used_amount: 1200, net_days: 30, status: "active", blocked: false, demo: true })
  assert.equal(dto.customer_name, "Firma")
  assert.equal(dto.limit_amount, 1000)
  assert.equal(dto.used_amount, 1200)
  assert.equal(dto.remaining_amount, 0)
  assert.equal(dto.exhausted, true)
  assert.equal(dto.demo, true)
})

test("store: unknown statuses read active, numbers read zero", () => {
  const dto = toLimit({ id: "crl_1", customer_id: "cus_1", status: "cos", limit_amount: "abc", used_amount: null, net_days: "x" })
  assert.equal(dto.status, "active")
  assert.equal(dto.limit_amount, 0)
  assert.equal(dto.net_days, 0)
})

test("store: a credit order maps its state and dates", () => {
  const o = toCreditOrder({ id: "cro_1", order_id: "order_1", display_id: 42, customer_id: "cus_1", currency_code: "pln", total_amount: 250, net_days: 14, due_at: new Date("2026-01-20T00:00:00Z"), paid_at: null, state: "overdue", demo: false })
  assert.equal(o.display_id, 42)
  assert.equal(o.total_amount, 250)
  assert.equal(o.state, "overdue")
  assert.equal(o.paid_at, null)
  assert.equal(toCreditOrder({ id: "cro_2", order_id: "order_2", state: "cos" }).state, "open")
})
