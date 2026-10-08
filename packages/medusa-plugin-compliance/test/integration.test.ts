/**
 * EU Compliance in the koda.integration/1 contract: the shared conformance
 * checks with a fake scope, then what the plugin itself promises: a product
 * without a record has no line, an incomplete record reads attention, a
 * complete one ok; a customer's line follows their data requests; the board
 * counters count the incomplete records and the open requests.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { complianceIntegration } from "../src/workflows/compliance/integration.ts"
import { complianceCounters, customerSummary, productSummary } from "../src/modules/compliance/lib/integration.ts"
import { conformance } from "./kit-conformance.ts"

type Row = Record<string, unknown>

function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined || filter === null) return true
  if (Array.isArray(filter)) return filter.includes(value)
  return value === filter
}

/** A fake request container: the plugin's service over in-memory rows. */
function fakeScope(input: { products?: Row[]; operators?: Row[]; dsr?: Row[] } = {}) {
  const products = input.products ?? []
  const operators = input.operators ?? []
  const dsr = input.dsr ?? []
  const svc = {
    isDemo: () => true,
    listComplianceProducts: async (filters: Record<string, unknown> = {}) =>
      products.filter((p) => matches(p.product_id, filters.product_id) && matches(p.complete, filters.complete)),
    listComplianceOperators: async (filters: Record<string, unknown> = {}) => operators.filter((o) => matches(o.id, filters.id)),
    listComplianceDsrs: async (filters: Record<string, unknown> = {}) => dsr.filter((d) => matches(d.customer_id, filters.customer_id) && matches(d.status, filters.status)),
  }
  return { resolve: (key: string) => (key === "compliance" ? svc : undefined) } as never
}

const PRODUCTS = [
  { id: "cpr_1", product_id: "prod_1", complete: true, manufacturer_id: "crp_m", responsible_person_id: "crp_r", demo: true },
  { id: "cpr_2", product_id: "prod_2", complete: false, manufacturer_id: null, responsible_person_id: null, demo: true },
]
const OPERATORS = [
  { id: "crp_m", kind: "manufacturer", name: "Maker GmbH" },
  { id: "crp_r", kind: "responsible_person", name: "Responsible Sp. z o.o." },
]
const DSR = [
  { id: "cdsr_1", customer_id: "cus_1", type: "access", status: "pending", created_at: "2026-01-02T00:00:00.000Z" },
  { id: "cdsr_2", customer_id: "cus_2", type: "erasure", status: "completed", created_at: "2026-01-01T00:00:00.000Z" },
]

{
  const scope = fakeScope({ products: PRODUCTS, operators: OPERATORS, dsr: DSR })
  conformance({ routes: complianceIntegration, scope, entity: "product", knownIds: ["prod_1", "prod_2", "prod_3"], writes: () => [] })
}
{
  const scope = fakeScope({ products: PRODUCTS, operators: OPERATORS, dsr: DSR })
  conformance({ routes: complianceIntegration, scope, entity: "customer", knownIds: ["cus_1", "cus_2"] })
}

test("integration: a product without a record has no line", () => {
  assert.equal(productSummary("prod_9", undefined, { manufacturer: null, responsible: null }), undefined)
})

test("integration: an incomplete record reads attention and names what is missing", () => {
  const s = productSummary("prod_2", { product_id: "prod_2", complete: false, manufacturer_id: null, responsible_person_id: null }, { manufacturer: null, responsible: null })
  assert.equal(s?.state, "attention")
  assert.equal(s?.title.key, "integration.product.incomplete")
  assert.equal(s?.detail?.key, "integration.product.missingManufacturer")
  const s2 = productSummary("prod_2", { product_id: "prod_2", complete: false, manufacturer_id: "m", responsible_person_id: null }, { manufacturer: "Maker", responsible: null })
  assert.equal(s2?.detail?.key, "integration.product.missingResponsible")
})

test("integration: a complete record reads ok with the manufacturer", () => {
  const s = productSummary("prod_1", { product_id: "prod_1", complete: true, manufacturer_id: "m", responsible_person_id: "r" }, { manufacturer: "Maker GmbH", responsible: null })
  assert.equal(s?.state, "ok")
  assert.deepEqual(s?.detail, { key: "integration.product.manufacturer", params: { name: "Maker GmbH" } })
})

test("integration: a customer's line follows the open requests", () => {
  const open = customerSummary("cus_1", [{ customer_id: "cus_1", type: "access", status: "pending", created_at: null }])
  assert.equal(open?.state, "attention")
  assert.deepEqual(open?.title, { key: "integration.customer.open", params: { count: 1 } })
  const done = customerSummary("cus_2", [{ customer_id: "cus_2", type: "erasure", status: "completed", created_at: null }])
  assert.equal(done?.state, "ok")
  assert.deepEqual(done?.title, { key: "integration.customer.done", params: { count: 1 } })
  assert.equal(customerSummary("cus_9", []), undefined)
})

test("integration: the counters link to the Compliance page", () => {
  const c = complianceCounters({ productsIncomplete: 3, dsrOpen: 2 })
  assert.equal(c.length, 2)
  assert.equal(c[0].key, "products_incomplete")
  assert.equal(c[0].scope, "products")
  assert.equal(c[0].count, 3)
  assert.deepEqual(c[0].link, { kind: "admin", href: "/compliance" })
  assert.equal(c[1].key, "dsr_open")
  assert.equal(c[1].scope, "customers")
  assert.equal(c[1].count, 2)
})
