/**
 * Packaging in the koda.integration/1 contract: the shared conformance
 * checks with a fake scope, then what the plugin itself promises: a product
 * without a ladder has no line, a ladder reads ok with the biggest unit
 * counted, and the counter counts the products without one.
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { packagingIntegration } from "../src/workflows/packaging/integration.ts"
import { packagingCounters, productSummary } from "../src/modules/packaging/lib/integration.ts"
import { conformance } from "./kit-conformance.ts"

type Row = Record<string, unknown>

function matches(value: unknown, filter: unknown): boolean {
  if (filter === undefined || filter === null) return true
  if (Array.isArray(filter)) return filter.includes(value)
  return value === filter
}

/** A fake request container: the plugin's service over in-memory rows. */
function fakeScope(input: { products?: Row[]; units?: Row[] } = {}) {
  const products = input.products ?? []
  const units = input.units ?? []
  const svc = {
    isDemo: () => true,
    listPackagingProducts: async (filters: Record<string, unknown> = {}) => products.filter((p) => matches(p.product_id, filters.product_id)),
    listPackagingUnits: async (filters: Record<string, unknown> = {}) => units.filter((u) => matches(u.product_id, filters.product_id)),
  }
  return { resolve: (key: string) => (key === "packaging" ? svc : undefined) } as never
}

const PRODUCTS = [
  { id: "ppr_1", product_id: "prod_1", moq: 12, step: 12 },
  { id: "ppr_2", product_id: "prod_2", moq: 0, step: 0 },
]
const UNITS = [
  { id: "pku_1", product_id: "prod_1", name: "szt.", pieces: 1 },
  { id: "pku_2", product_id: "prod_1", name: "karton", pieces: 12 },
  { id: "pku_3", product_id: "prod_1", name: "paleta", pieces: 120 },
]

{
  const scope = fakeScope({ products: PRODUCTS, units: UNITS })
  conformance({ routes: packagingIntegration, scope, entity: "product", knownIds: ["prod_1", "prod_2", "prod_3"], writes: () => [] })
}

test("integration: a product without a ladder has no line", () => {
  assert.equal(productSummary("prod_9", undefined), undefined)
  assert.equal(productSummary("prod_9", { moq: 0, step: 0, units: [] }), undefined)
})

test("integration: the line reads the ladder and the MOQ", () => {
  const s = productSummary("prod_1", { moq: 12, step: 12, units: [{ name: "szt.", pieces: 1 }, { name: "karton", pieces: 12 }, { name: "paleta", pieces: 120 }] })
  assert.equal(s?.state, "ok")
  assert.deepEqual(s?.title, { key: "integration.product.ladder", params: { line: "szt. 1 / karton 12 / paleta 120" } })
  assert.deepEqual(s?.detail, { key: "integration.product.moq", params: { moq: 12, step: 12 } })
  assert.deepEqual(s?.counts, { biggest: 120 })
  assert.deepEqual(s?.links, [{ kind: "admin", href: "/packaging" }])
})

test("integration: the counter links to the Packaging page", () => {
  const c = packagingCounters({ without: 3 })
  assert.equal(c.length, 1)
  assert.equal(c[0].key, "without_ladder")
  assert.equal(c[0].scope, "products")
  assert.equal(c[0].count, 3)
  assert.deepEqual(c[0].link, { kind: "admin", href: "/packaging" })
})
