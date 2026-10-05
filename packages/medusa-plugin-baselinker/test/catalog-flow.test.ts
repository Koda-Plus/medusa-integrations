/**
 * The catalog run end to end: the real `runCatalogSync` (variants from the
 * graph, the read, matching, the snapshot with the complete-read rule, the
 * run record and the stock plan) against an in-memory service and a fake
 * container. Live reads go to a scripted connector.php; nothing leaves the
 * process. Stock is planned only (writing goes through Medusa's own workflow).
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions, type BaseLinkerPluginOptions } from "../src/modules/baselinker/lib/options.ts"
import { maskSecrets } from "../src/modules/baselinker/lib/security.ts"
import { runCatalogSync } from "../src/workflows/baselinker/catalog.ts"

type Row = Record<string, any>

function matches(row: Row, filter: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (Array.isArray(cond)) {
      if (!cond.includes(row[key])) return false
    } else if (cond === null) {
      if (row[key] !== null && row[key] !== undefined) return false
    } else if (row[key] !== cond) return false
  }
  return true
}

class Table {
  rows: Row[] = []
  private seq = 0
  private readonly prefix: string
  constructor(prefix: string) {
    this.prefix = prefix
  }
  list(filter: Record<string, unknown> = {}, config: { skip?: number; take?: number | null } = {}): Row[] {
    const found = this.rows.filter((r) => matches(r, filter))
    const skip = config.skip ?? 0
    const take = config.take === null || config.take === undefined ? found.length : config.take
    return found.slice(skip, skip + take).map((r) => ({ ...r }))
  }
  create(data: Row | Row[]): Row | Row[] {
    const one = (d: Row) => {
      const row = { id: `${this.prefix}_${++this.seq}`, created_at: new Date(), updated_at: new Date(), ...d }
      this.rows.push(row)
      return { ...row }
    }
    return Array.isArray(data) ? data.map(one) : one(data)
  }
  update(data: Row | Row[]): Row | Row[] {
    const one = (d: Row) => {
      const row = this.rows.find((r) => r.id === d.id) as Row
      Object.assign(row, d)
      return { ...row }
    }
    return Array.isArray(data) ? data.map(one) : one(data)
  }
  delete(ids: string[]): void {
    this.rows = this.rows.filter((r) => !ids.includes(r.id))
  }
}

const variants = [
  { id: "var_a", title: "Default variant", sku: "OP-A", ean: null, barcode: null, upc: null, product_id: "prod_a", manage_inventory: true, product: { title: "Opona A" }, inventory_items: [{ inventory_item_id: "ii_a", required_quantity: 1 }] },
  { id: "var_b", title: "16 cali", sku: "OP-B", ean: "5901234123457", barcode: null, upc: null, product_id: "prod_b", manage_inventory: true, product: { title: "Opona B" }, inventory_items: [{ inventory_item_id: "ii_b", required_quantity: 1 }] },
  { id: "var_c", title: "Default variant", sku: "OP-C", ean: null, barcode: null, upc: null, product_id: "prod_c", manage_inventory: true, product: { title: "Opona C" }, inventory_items: [{ inventory_item_id: "ii_c", required_quantity: 1 }] },
  { id: "var_d", title: "Default variant", sku: "OP-D", ean: null, barcode: null, upc: null, product_id: "prod_d", manage_inventory: true, product: { title: "Opona D" }, inventory_items: [{ inventory_item_id: "ii_d", required_quantity: 1 }] },
]
const levels = [
  { id: "lvl_a", inventory_item_id: "ii_a", stocked_quantity: 4, reserved_quantity: 1 },
  { id: "lvl_b", inventory_item_id: "ii_b", stocked_quantity: 2, reserved_quantity: 0 },
  { id: "lvl_c", inventory_item_id: "ii_c", stocked_quantity: 7, reserved_quantity: 0 },
]

function setup(options: BaseLinkerPluginOptions) {
  const o = resolveOptions(options)
  const t = { products: new Table("blprod"), changes: new Table("blstk"), runs: new Table("blrun") }
  const svc = {
    getOptions: () => o,
    getLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }),
    isDemo: () => o.demo,
    isConfigured: () => true,
    missingOptions: () => [],
    mask: (s: string) => maskSecrets(s, [o.apiToken]),
    listBaseLinkerProducts: async (f: Row, c: Row) => t.products.list(f, c),
    createBaseLinkerProducts: async (d: Row) => t.products.create(d),
    updateBaseLinkerProducts: async (d: Row) => t.products.update(d),
    deleteBaseLinkerProducts: async (ids: string[]) => t.products.delete(ids),
    listBaseLinkerStockChanges: async (f: Row, c: Row) => t.changes.list(f, c),
    createBaseLinkerStockChanges: async (d: Row) => t.changes.create(d),
    deleteBaseLinkerStockChanges: async (ids: string[]) => t.changes.delete(ids),
    createBaseLinkerSyncRuns: async (d: Row) => t.runs.create(d),
    listBaseLinkerSyncRuns: async (f: Row, c: Row) => t.runs.list(f, c),
    deleteBaseLinkerSyncRuns: async (ids: string[]) => t.runs.delete(ids),
  }
  const registry: Record<string, unknown> = {
    baselinker: svc,
    query: {
      graph: async ({ entity, pagination, filters }: Row) => {
        if (entity !== "product_variant") return { data: [] }
        if (filters?.id) return { data: variants.filter((v) => filters.id.includes(v.id)).map((v) => ({ id: v.id, prices: [{ amount: 300, currency_code: "pln" }] })) }
        const skip = pagination?.skip ?? 0
        return { data: variants.slice(skip, skip + (pagination?.take ?? 500)) }
      },
    },
    stock_location: { listStockLocations: async () => [{ id: "sloc_1" }] },
    inventory: { listInventoryLevels: async () => levels },
  }
  const container = {
    resolve: (key: string) => {
      if (!(key in registry)) throw new Error(`not registered: ${key}`)
      return registry[key]
    },
  }
  return { container, t }
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

/**
 * Pages of `getInventoryProductsList` (1 000 per page in the real API: a short
 * page ends the read). Installed once per test, because the plugin keeps one
 * client per service; `pages` can be swapped between runs.
 */
function fakeCatalog(initial: Array<Record<string, Row> | Error>) {
  const state = { pages: initial, calls: [] as number[] }
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url) !== "https://api.baselinker.com/connector.php") throw new Error(`unexpected URL ${String(url)}`)
    const body = new URLSearchParams(String(init?.body ?? ""))
    const params = JSON.parse(body.get("parameters") ?? "{}")
    assert.equal(body.get("method"), "getInventoryProductsList")
    state.calls.push(params.page)
    const page = state.pages[params.page - 1] ?? {}
    if (page instanceof Error) return new Response(JSON.stringify({ status: "ERROR", error_code: "ERROR_BAD_PARAMETERS", error_message: page.message }))
    return new Response(JSON.stringify({ status: "SUCCESS", products: page }))
  }) as typeof fetch
  return state
}

const live: BaseLinkerPluginOptions = { apiToken: "t0ken-t0ken-t0ken", inventoryId: 23397, warehouseId: "bl_1", orderStatusId: 1 }

test("live: cards linked by SKU and EAN, duplicates reported, the stock plan stored and nothing written", async () => {
  const fake = fakeCatalog([
    {
      "101": { sku: "op-a", name: "A", stock: { bl_1: 3 } },
      "102": { sku: "OTHER", ean: "5901234123457", name: "B", stock: { bl_1: 5 } },
      "103": { sku: "OP-C", name: "C1", stock: { bl_1: 1 } },
      "104": { sku: "OP-C", name: "C2", stock: { bl_1: 9 } },
      "105": { sku: "ONLY-BL", name: "X", stock: { shop_1: 2 } },
    },
  ])
  const s = setup(live)
  const res = await runCatalogSync(s.container, { trigger: "manual" })
  assert.deepEqual(fake.calls, [1])
  assert.equal(res.run?.status, "ok")
  assert.equal(res.run?.complete, true)
  const byId = new Map(s.t.products.rows.map((r) => [r.bl_product_id, r]))
  assert.equal(byId.get("101")?.variant_id, "var_a")
  assert.equal(byId.get("102")?.variant_id, "var_b")
  assert.equal(byId.get("102")?.match_source, "ean")
  assert.equal(byId.get("103")?.conflict, "duplicate_sku")
  assert.equal(byId.get("105")?.stock, null)
  assert.equal(res.run?.counts.onlyInMedusa, 1, "OP-D has no card")

  /* Plan: A 3 + 1 reserved = 4 (unchanged), B 5 (was 2). C is in conflict, D has no card. */
  assert.equal(res.stockRun?.status, "ok")
  assert.equal(s.t.changes.rows.length, 1)
  assert.equal(s.t.changes.rows[0].variant_id, "var_b")
  assert.equal(s.t.changes.rows[0].target, 5)
  assert.equal(s.t.changes.rows[0].status, "planned")
})

test("live: an incomplete read keeps the cards it did not see and plans no stock", async () => {
  const fake = fakeCatalog([Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [String(1000 + i), { sku: i === 0 ? "OP-A" : `X-${i}`, stock: { bl_1: 1 } }]))])
  const s = setup(live)
  const first = await runCatalogSync(s.container, { trigger: "manual" })
  assert.equal(first.run?.complete, true, "1 000 cards then an empty page")
  assert.deepEqual(fake.calls, [1, 2])
  const before = s.t.products.rows.length

  fake.pages = [new Error("page failed")]
  const second = await runCatalogSync(s.container, { trigger: "manual" })
  assert.equal(second.run?.status, "error")
  assert.equal(second.run?.complete, false)
  assert.equal(s.t.products.rows.length, before, "nothing removed")
  assert.equal(second.stockRun?.status, "partial")
  assert.equal(second.stockRun?.counts.skipped, "incomplete_read")
})

test("demo: the simulated account builds the snapshot and a plan from the store's own catalog", async () => {
  const s = setup({ demo: true })
  const res = await runCatalogSync(s.container, { trigger: "auto" })
  assert.equal(res.run?.status, "ok")
  assert.ok(s.t.products.rows.length >= variants.length)
  assert.ok(s.t.products.rows.every((r) => r.demo === true))
  assert.ok(s.t.products.rows.some((r) => r.conflict === "duplicate_sku"))
  assert.ok(s.t.products.rows.some((r) => r.sku === null))
  assert.equal(res.stockRun?.counts.mode, "plan")
})
