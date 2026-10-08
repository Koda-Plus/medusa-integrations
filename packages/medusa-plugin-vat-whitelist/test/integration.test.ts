/**
 * VAT Whitelist in the koda.integration/1 contract: the shared conformance
 * checks with a fake scope, then what the plugin itself promises: a customer
 * without a linked counterparty has no line, an active payer reads ok, an
 * exempt one attention, a missing one failed; the counter counts the linked
 * counterparties that need a look.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { whitelistIntegration } from "../src/workflows/whitelist/integration.ts"
import { customerSummary, whitelistCounters } from "../src/modules/whitelist/lib/integration.ts"
import { conformance } from "./kit-conformance.ts"

type Row = Record<string, unknown>

function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined || filter === null) return true
  if (Array.isArray(filter)) return filter.includes(value)
  return value === filter
}

/** A fake request container: the plugin's service over in-memory rows. */
function fakeScope(input: { entities?: Row[] } = {}) {
  const entities = input.entities ?? []
  const svc = {
    isDemo: () => true,
    listWhitelistEntities: async (filters: Record<string, unknown> = {}) => entities.filter((e) => matches(e.customer_id, filters.customer_id) && matches(e.state, filters.state)),
  }
  return { resolve: (key: string) => (key === "whitelist" ? svc : undefined) } as never
}

const ENTITIES = [
  { id: "wen_1", nip: "1234563218", state: "active", name: "Hurtownia Demo Sp. z o.o.", customer_id: "cus_1" },
  { id: "wen_2", nip: "0123456789", state: "exempt", name: "Warsztat Demo", customer_id: "cus_2" },
  { id: "wen_3", nip: "1111111111", state: "not_found", name: null, customer_id: "cus_3" },
  { id: "wen_4", nip: "1234563218", state: "active", name: "Niezwiązany kontrahent", customer_id: null },
]

{
  const scope = fakeScope({ entities: ENTITIES })
  conformance({ routes: whitelistIntegration, scope, entity: "customer", knownIds: ["cus_1", "cus_2", "cus_3", "cus_4"], writes: () => [] })
}

test("integration: a customer without a linked counterparty has no line", () => {
  assert.equal(customerSummary("cus_9", undefined), undefined)
})

test("integration: the line follows the counterparty state", () => {
  const active = customerSummary("cus_1", { id: "wen_1", nip: "1234563218", state: "active", name: "Firma", customer_id: "cus_1" })
  assert.equal(active?.state, "ok")
  assert.deepEqual(active?.title, { key: "integration.customer.active", params: { name: "Firma" } })
  const exempt = customerSummary("cus_2", { id: "wen_2", nip: "0123456789", state: "exempt", name: null, customer_id: "cus_2" })
  assert.equal(exempt?.state, "attention")
  assert.deepEqual(exempt?.title, { key: "integration.customer.exempt", params: { name: "0123456789" } })
  const missing = customerSummary("cus_3", { id: "wen_3", nip: "1111111111", state: "not_found", name: null, customer_id: "cus_3" })
  assert.equal(missing?.state, "failed")
  assert.deepEqual(missing?.links, [{ kind: "admin", href: "/whitelist" }])
})

test("integration: the counter links to the Whitelist page", () => {
  const c = whitelistCounters({ unverified: 2 })
  assert.equal(c.length, 1)
  assert.equal(c[0].key, "unverified")
  assert.equal(c[0].scope, "customers")
  assert.equal(c[0].count, 2)
  assert.deepEqual(c[0].link, { kind: "admin", href: "/whitelist" })
})
