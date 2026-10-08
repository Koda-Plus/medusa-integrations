/**
 * Loyalty in the koda.integration/1 contract: the shared conformance checks
 * with a fake scope, then what the plugin itself promises: a customer
 * without an account has no line, points read active with the reward hint
 * above the ladder, an empty balance reads ok with the earned total.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { loyaltyIntegration } from "../src/workflows/loyalty/integration.ts"
import { customerSummary, loyaltyCounters } from "../src/modules/loyalty/lib/integration.ts"
import { conformance } from "./kit-conformance.ts"

type Row = Record<string, unknown>

function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined || filter === null) return true
  if (Array.isArray(filter)) return filter.includes(value)
  return value === filter
}

/** A fake request container: the plugin's service over in-memory rows. */
function fakeScope(input: { accounts?: Row[] } = {}) {
  const accounts = input.accounts ?? []
  const svc = {
    isDemo: () => true,
    getOptions: () => ({ demo: true, pointsPerPln: 1, redeemRate: 0.05, rewards: [{ at: 1500, name: { en: "Reward", pl: "Nagroda" } }] }),
    listLoyaltyAccounts: async (filters: Record<string, unknown> = {}) => accounts.filter((a) => matches(a.customer_id, filters.customer_id)),
  }
  return { resolve: (key: string) => (key === "loyalty" ? svc : undefined) } as never
}

const ACCOUNTS = [
  { id: "lac_1", customer_id: "cus_1", balance: 1600, total_earned: 3100 },
  { id: "lac_2", customer_id: "cus_2", balance: 0, total_earned: 900 },
]

const money = (n: number) => `${n.toFixed(2)} zł`

{
  const scope = fakeScope({ accounts: ACCOUNTS })
  conformance({ routes: loyaltyIntegration, scope, entity: "customer", knownIds: ["cus_1", "cus_2", "cus_3"], writes: () => [] })
}

test("integration: a customer without an account has no line", () => {
  assert.equal(customerSummary("cus_9", undefined, money), undefined)
})

test("integration: points read active, with the reward hint above the ladder", () => {
  const s = customerSummary("cus_1", { balance: 1600, total_earned: 3100, first_reward_at: 1500 }, money)
  assert.equal(s?.state, "active")
  assert.deepEqual(s?.title, { key: "integration.customer.points", params: { count: 1600 } })
  assert.deepEqual(s?.detail, { key: "integration.customer.ready", params: { count: 1500 } })
  assert.deepEqual(s?.counts, { points: 1600 })
})

test("integration: an empty balance reads ok with the earned total", () => {
  const s = customerSummary("cus_2", { balance: 0, total_earned: 900, first_reward_at: 1500 }, money)
  assert.equal(s?.state, "ok")
  assert.deepEqual(s?.detail, { key: "integration.customer.earned", params: { count: 900 } })
})

test("integration: the counter links to the Loyalty page", () => {
  const c = loyaltyCounters({ ready: 2 })
  assert.equal(c.length, 1)
  assert.equal(c[0].key, "ready")
  assert.equal(c[0].scope, "customers")
  assert.equal(c[0].count, 2)
  assert.deepEqual(c[0].link, { kind: "admin", href: "/loyalty" })
})
