/**
 * Trade Credit in the koda.integration/1 contract: the shared conformance
 * checks with a fake scope, then what the plugin itself promises: a customer
 * without terms has no line, a blocked customer reads failed, an overdue
 * customer failed, an exhausted limit attention, a partly used limit active.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { creditIntegration } from "../src/workflows/credit/integration.ts"
import { creditCounters, customerSummary, type LimitRow } from "../src/modules/credit/lib/integration.ts"
import { conformance } from "./kit-conformance.ts"

type Row = Record<string, unknown>

function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined || filter === null) return true
  if (Array.isArray(filter)) return filter.includes(value)
  return value === filter
}

/** A fake request container: the plugin's service over in-memory rows. */
function fakeScope(input: { limits?: Row[]; orders?: Row[] } = {}) {
  const limits = input.limits ?? []
  const orders = input.orders ?? []
  const svc = {
    isDemo: () => true,
    listCreditLimits: async (filters: Record<string, unknown> = {}) => limits.filter((l) => matches(l.customer_id, filters.customer_id)),
    listCreditOrders: async (filters: Record<string, unknown> = {}) => orders.filter((o) => matches(o.customer_id, filters.customer_id) && matches(o.state, filters.state)),
  }
  return { resolve: (key: string) => (key === "credit" ? svc : undefined) } as never
}

const LIMITS = [
  { id: "crl_1", customer_id: "cus_1", limit_amount: 5000, used_amount: 1200, net_days: 30, blocked: false, status: "active" },
  { id: "crl_2", customer_id: "cus_2", limit_amount: 1000, used_amount: 1000, net_days: 14, blocked: false, status: "active" },
  { id: "crl_3", customer_id: "cus_3", limit_amount: 3000, used_amount: 0, net_days: 30, blocked: true, status: "active" },
]
const ORDERS = [{ id: "cro_1", order_id: "order_1", customer_id: "cus_2", state: "overdue", total_amount: 200 }]

const money = (n: number) => `${n.toFixed(2)} zł`

{
  const scope = fakeScope({ limits: LIMITS, orders: ORDERS })
  conformance({ routes: creditIntegration, scope, entity: "customer", knownIds: ["cus_1", "cus_2", "cus_3", "cus_4"], writes: () => [] })
}

test("integration: a customer without terms has no line", () => {
  assert.equal(customerSummary("cus_9", undefined, 0, money), undefined)
})

test("integration: the line follows the limit and the overdue orders", () => {
  const active: LimitRow = { blocked: false, exhausted: false, used_amount: 1200, limit_amount: 5000, remaining_amount: 3800, net_days: 30 }
  const s = customerSummary("cus_1", active, 0, money)
  assert.equal(s?.state, "active")
  assert.deepEqual(s?.title, { key: "integration.customer.used", params: { used: "1200.00 zł", limit: "5000.00 zł", remaining: "3800.00 zł" } })
  const exhausted: LimitRow = { blocked: false, exhausted: true, used_amount: 1000, limit_amount: 1000, remaining_amount: 0, net_days: 14 }
  assert.equal(customerSummary("cus_2", exhausted, 0, money)?.state, "attention")
  assert.equal(customerSummary("cus_2", exhausted, 1, money)?.state, "failed")
  const blocked: LimitRow = { blocked: true, exhausted: false, used_amount: 0, limit_amount: 3000, remaining_amount: 3000, net_days: 30 }
  assert.equal(customerSummary("cus_3", blocked, 0, money)?.state, "failed")
})

test("integration: the counter links to the Credit page", () => {
  const c = creditCounters({ attention: 2 })
  assert.equal(c.length, 1)
  assert.equal(c[0].key, "to_check")
  assert.equal(c[0].scope, "customers")
  assert.equal(c[0].count, 2)
  assert.deepEqual(c[0].link, { kind: "admin", href: "/credit" })
})
