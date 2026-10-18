/**
 * Store mode: the plugin is the page over the credit a store already keeps.
 * The store's accounts and orders map to the page's DTOs, the account id is
 * the customer id, and the options switch demo and enforce off.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { accountToLimit, storeOrderToDto, storeStatus } from "../src/modules/credit/lib/store-mode.ts"
import { resolveOptions } from "../src/modules/credit/lib/options.ts"
import type { CreditStoreAdapter, StoreCreditAccount, StoreCreditOrder } from "../src/modules/credit/lib/store-adapter.ts"

const account = (over: Partial<StoreCreditAccount> = {}): StoreCreditAccount => ({
  customer_id: "cus_1",
  email: "a@example.com",
  name: "Anna",
  limit_amount: 1000,
  net_days: 14,
  used_amount: 400.456,
  overdue_amount: 0,
  oldest_overdue_days: 0,
  open_orders: 2,
  ...over,
})

const order = (over: Partial<StoreCreditOrder> = {}): StoreCreditOrder => ({
  order_id: "order_1",
  display_id: 7,
  customer_id: "cus_1",
  total_amount: 300,
  unpaid_amount: 300,
  due_at: "2026-10-20",
  overdue_days: 0,
  ...over,
})

test("store mode: an account maps with the customer as its id and what is left", () => {
  const l = accountToLimit(account())
  assert.equal(l.id, "cus_1")
  assert.equal(l.used_amount, 400.46)
  assert.equal(l.remaining_amount, 599.54)
  assert.equal(l.exhausted, false)
  assert.equal(l.no_limit, false)
})

test("store mode: no limit reads no_limit, a used up limit reads exhausted", () => {
  assert.equal(accountToLimit(account({ limit_amount: null })).no_limit, true)
  assert.equal(accountToLimit(account({ limit_amount: null })).exhausted, false)
  assert.equal(accountToLimit(account({ used_amount: 1000 })).exhausted, true)
  assert.equal(accountToLimit(account({ used_amount: 1200 })).remaining_amount, 0)
})

test("store mode: an order without a due date is open with no_due_date", () => {
  const o = storeOrderToDto(order({ due_at: null }))
  assert.equal(o.no_due_date, true)
  assert.equal(o.due_at, "")
  assert.equal(o.state, "open")
  const late = storeOrderToDto(order({ overdue_days: 3 }))
  assert.equal(late.state, "overdue")
  assert.equal(late.due_at, "2026-10-20T23:59:59.000Z")
})

test("store mode: the status counts the overdue total and passes the store's choices", async () => {
  const store: CreditStoreAdapter = {
    accounts: async () => [account({ overdue_amount: 150.5 }), account({ customer_id: "cus_2", limit_amount: 100, used_amount: 100 })],
    orders: async () => [order({ overdue_days: 2 }), order({ order_id: "order_2", customer_id: "cus_2" })],
    update: async () => {},
    capabilities: { block: false, pause: false },
    netDayChoices: [0, 7, 14, 21],
    maxNetDays: 21,
    ruleText: "rule",
  }
  const s = await storeStatus({}, store)
  assert.equal(s.mode, "store")
  assert.equal(s.counts.limits, 2)
  assert.equal(s.counts.exhausted, 1)
  assert.equal(s.counts.overdue, 1)
  assert.equal(s.counts.overdue_total, 150.5)
  assert.deepEqual(s.netDayChoices, [0, 7, 14, 21])
  assert.deepEqual(s.capabilities, { block: false, pause: false })
})

test("store mode: the options keep the store and switch demo and enforce off", () => {
  const store: CreditStoreAdapter = { accounts: async () => [], orders: async () => [], update: async () => {} }
  const o = resolveOptions({ demo: true, enforce: true, store })
  assert.equal(o.store, store)
  assert.equal(o.demo, false)
  assert.equal(o.enforce, false)
  assert.equal(resolveOptions({ store: { nope: 1 } as never }).store, null)
})
