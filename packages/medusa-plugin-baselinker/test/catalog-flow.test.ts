/**
 * The catalog run end to end: the real `runCatalogSync` (variants from the
 * graph, the read, matching, the snapshot with the complete-read rule, the run
 * record, the stock plan and, since 0.2, the plans of the directions) against
 * an in-memory service and a fake container. Live reads go to a scripted
 * connector.php; nothing leaves the process.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import type { BaseLinkerPluginOptions } from "../src/modules/baselinker/lib/options.ts"
import { runCatalogSync } from "../src/workflows/baselinker/catalog.ts"
import { setArm, writeSetting } from "../src/workflows/baselinker/settings.ts"
import { fakeContainer, fakeQuery, fakeService, scriptedBaseLinker, silentEvents, type Row } from "./fakes.ts"

const variants = [
  { id: "var_a", title: "Default variant", sku: "OP-A", ean: null, product_id: "prod_a", manage_inventory: true, product: { title: "Opona A" }, inventory_items: [{ inventory_item_id: "ii_a", required_quantity: 1 }] },
  { id: "var_b", title: "16 cali", sku: "OP-B", ean: "5901234123457", product_id: "prod_b", manage_inventory: true, product: { title: "Opona B" }, inventory_items: [{ inventory_item_id: "ii_b", required_quantity: 1 }] },
  { id: "var_c", title: "Default variant", sku: "OP-C", ean: null, product_id: "prod_c", manage_inventory: true, product: { title: "Opona C" }, inventory_items: [{ inventory_item_id: "ii_c", required_quantity: 1 }] },
  { id: "var_d", title: "Default variant", sku: "OP-D", ean: null, product_id: "prod_d", manage_inventory: true, product: { title: "Opona D" }, inventory_items: [{ inventory_item_id: "ii_d", required_quantity: 1 }] },
]
const levels = [
  { id: "lvl_a", inventory_item_id: "ii_a", stocked_quantity: 4, reserved_quantity: 1 },
  { id: "lvl_b", inventory_item_id: "ii_b", stocked_quantity: 2, reserved_quantity: 0 },
  { id: "lvl_c", inventory_item_id: "ii_c", stocked_quantity: 7, reserved_quantity: 0 },
]

/** Medusa products as `loadMedusaCatalog` reads them. */
const products = variants.map((v) => ({
  id: v.product_id,
  title: v.product.title,
  handle: v.product.title.toLowerCase().replace(/\s+/g, "-"),
  description: null,
  status: "published",
  metadata: {},
  images: [],
  categories: [],
  tags: [],
  options: [],
  variants: [{ id: v.id, title: v.title, sku: v.sku, ean: v.ean, weight: null, manage_inventory: true, prices: [{ amount: 300, currency_code: "pln", rules_count: 0, price_list_id: null }], price_set: { id: `pset_${v.id}` } }],
}))

function setup(options: BaseLinkerPluginOptions) {
  const s = fakeService(options)
  const { events, bus } = silentEvents()
  const registry: Record<string, unknown> = {
    baselinker: s.svc,
    query: fakeQuery({
      product_variant: ({ pagination, filters }: Row) => {
        if (filters?.id) return variants.filter((v) => filters.id.includes(v.id)).map((v) => ({ id: v.id, prices: [{ amount: 300, currency_code: "pln" }] }))
        const skip = pagination?.skip ?? 0
        return variants.slice(skip, skip + (pagination?.take ?? 500))
      },
      product: ({ pagination }: Row) => products.slice(pagination?.skip ?? 0, (pagination?.skip ?? 0) + (pagination?.take ?? 100)),
      product_category: () => [{ id: "pcat_1", name: "Akcesoria warsztatowe" }],
      store: () => [{ id: "store_1", default_sales_channel_id: "sc_1" }],
    }),
    stock_location: { listStockLocations: async () => [{ id: "sloc_1" }] },
    inventory: { listInventoryLevels: async () => levels },
    pricing: { listPricePreferences: async () => [{ is_tax_inclusive: true }] },
    event_bus: bus,
  }
  return { container: fakeContainer(registry), s, events }
}

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

const live: BaseLinkerPluginOptions = { apiToken: "t0ken-t0ken-t0ken", inventoryId: 23397, warehouseId: "bl_1", orderStatusId: 1 }

test("live: cards linked by SKU and EAN, duplicates reported, the stock plan stored and nothing written", async () => {
  const bl = scriptedBaseLinker({
    getInventoryProductsList: (p) => {
      assert.equal(p.include_variants, true, "variants are read since 0.2")
      return {
        products:
          p.page === 1
            ? {
                "101": { sku: "op-a", name: "A", stock: { bl_1: 3 } },
                "102": { sku: "OTHER", ean: "5901234123457", name: "B", stock: { bl_1: 5 } },
                "103": { sku: "OP-C", name: "C1", stock: { bl_1: 1 } },
                "104": { sku: "OP-C", name: "C2", stock: { bl_1: 9 } },
                "105": { sku: "ONLY-BL", name: "X", stock: { shop_1: 2 } },
              }
            : {},
      }
    },
  })
  restore = bl.restore
  const t = setup(live)
  const res = await runCatalogSync(t.container, { trigger: "manual" })
  assert.deepEqual(bl.methods(), ["getInventoryProductsList"], "cards and prices write nothing and read nothing more without a writer")
  assert.equal(res.run?.status, "ok")
  assert.equal(res.run?.complete, true)
  const byId = new Map(t.s.table("Products").rows.map((r) => [r.bl_product_id, r]))
  assert.equal(byId.get("101")?.variant_id, "var_a")
  assert.equal(byId.get("102")?.variant_id, "var_b")
  assert.equal(byId.get("102")?.match_source, "ean")
  assert.equal(byId.get("103")?.conflict, "duplicate_sku")
  assert.equal(byId.get("105")?.stock, null)
  assert.equal(res.run?.counts.onlyInMedusa, 1, "OP-D has no card")

  /* Plan: A 3 + 1 reserved = 4 (unchanged), B 5 (was 2). C is in conflict, D has no card. */
  assert.equal(res.stockRun?.status, "ok")
  const changes = t.s.table("StockChanges").rows
  assert.equal(changes.length, 1)
  assert.equal(changes[0].variant_id, "var_b")
  assert.equal(changes[0].target, 5)
  assert.equal(changes[0].status, "planned")

  /* The card plan of the catalog in Medusa: OP-D gets a card, nothing is sent while the writer is not armed. */
  const cardPlan = t.s.table("PlanItems").rows.filter((r) => r.kind === "cards")
  assert.ok(cardPlan.some((r) => r.action === "create" && r.sku === "OP-D" && r.status === "planned"))
  assert.ok(cardPlan.some((r) => r.action === "conflict" && r.sku === "OP-C"))
})

test("live: a main card with variants is stored as a container and never linked; its variants are", async () => {
  const bl = scriptedBaseLinker({
    getInventoryProductsList: (p) => ({
      products:
        p.page === 1
          ? {
              "200": { parent_id: 0, sku: "OP-A", name: "Opona (główna karta)", stock: { bl_1: 0 } },
              "201": { parent_id: 200, sku: "OP-A", name: "Opona 16", stock: { bl_1: 3 } },
            }
          : {},
    }),
  })
  restore = bl.restore
  const t = setup({ ...live, stockSync: "off" })
  await runCatalogSync(t.container, { trigger: "manual" })
  const byId = new Map(t.s.table("Products").rows.map((r) => [r.bl_product_id, r]))
  assert.equal(byId.get("200")?.match_source, "parent")
  assert.equal(byId.get("200")?.variant_id, null)
  assert.equal(byId.get("200")?.conflict, null, "the container's SKU does not make a duplicate")
  assert.equal(byId.get("201")?.variant_id, "var_a")
})

test("live: an incomplete read keeps the cards it did not see and plans nothing", async () => {
  let fail = false
  const bl = scriptedBaseLinker({
    getInventoryProductsList: (p) => {
      if (fail) return { status: "ERROR", error_code: "ERROR_BAD_PARAMETERS", error_message: "page failed" }
      return { products: p.page === 1 ? Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [String(1000 + i), { sku: i === 0 ? "OP-A" : `X-${i}`, stock: { bl_1: 1 } }])) : {} }
    },
  })
  restore = bl.restore
  const t = setup(live)
  const first = await runCatalogSync(t.container, { trigger: "manual" })
  assert.equal(first.run?.complete, true, "1 000 cards then an empty page")
  assert.deepEqual(
    bl.calls.map((c) => c.params.page),
    [1, 2],
  )
  const before = t.s.table("Products").rows.length

  fail = true
  const second = await runCatalogSync(t.container, { trigger: "manual" })
  assert.equal(second.run?.status, "error")
  assert.equal(second.run?.complete, false)
  assert.equal(t.s.table("Products").rows.length, before, "nothing removed")
  assert.equal(second.stockRun?.status, "partial")
  assert.equal(second.stockRun?.counts.skipped, "incomplete_read")
  const cardsRun = second.planRuns?.find((r) => r.kind === "cards")
  assert.equal(cardsRun?.counts.skipped, "incomplete_read", "a card missing from a broken list would be created twice")
})

test("demo: the simulated account builds the snapshot and a plan from the store's own catalog", async () => {
  const t = setup({ demo: true })
  const res = await runCatalogSync(t.container, { trigger: "auto" })
  assert.equal(res.run?.status, "ok")
  assert.ok(t.s.table("Products").rows.length >= variants.length)
  assert.ok(t.s.table("Products").rows.every((r) => r.demo === true))
  assert.ok(t.s.table("Products").rows.some((r) => r.conflict === "duplicate_sku"))
  assert.ok(t.s.table("Products").rows.some((r) => r.conflict === "duplicate_ean"), "two cards share an EAN")
  assert.ok(t.s.table("Products").rows.some((r) => r.match_source === "parent"), "a main card with variants")
  assert.equal(res.stockRun?.counts.mode, "plan")
})

test("live import: details in batches, a plan with creates, updates and conflicts, nothing written without the writer", async () => {
  const bl = scriptedBaseLinker({
    getInventoryProductsList: (p) => ({
      products:
        p.page === 1
          ? {
              "101": { sku: "OP-A", name: "Opona A", prices: { "7": 320 }, stock: { bl_1: 3 } },
              "300": { sku: "NEW-1", ean: "5906660000014", name: "Nowa opona", prices: { "7": 199 }, stock: { bl_1: 9 } },
              "301": { sku: "DUP", ean: "", name: "Dup 1", stock: { bl_1: 1 } },
              "302": { sku: "dup", ean: "", name: "Dup 2", stock: { bl_1: 1 } },
            }
          : {},
    }),
    getInventoryProductsData: (p) => {
      assert.deepEqual(p.products, [101, 300, 301, 302])
      return {
        products: {
          "101": { sku: "OP-A", text_fields: { name: "Opona A" }, tax_rate: 23, prices: { "7": 320 }, weight: 0 },
          "300": { sku: "NEW-1", ean: "5906660000014", text_fields: { name: "Nowa opona", description: "Opis" }, tax_rate: 23, prices: { "7": 199 }, category_id: 3, manufacturer_id: 9, images: { "1": "https://cdn.example.com/x.jpg" } },
          "301": { sku: "DUP", text_fields: { name: "Dup 1" }, prices: { "7": 10 } },
          "302": { sku: "dup", text_fields: { name: "Dup 2" }, prices: { "7": 10 } },
        },
      }
    },
    getInventoryCategories: () => ({ categories: [{ category_id: 3, name: "Akcesoria warsztatowe", parent_id: 0 }] }),
    getInventoryManufacturers: () => ({ manufacturers: [{ manufacturer_id: 9, name: "Robotex" }] }),
  })
  restore = bl.restore
  const t = setup({ ...live, catalogSource: "baselinker", priceGroupId: 7, stockSync: "off" })
  const res = await runCatalogSync(t.container, { trigger: "manual" })
  const run = res.planRuns?.find((r) => r.kind === "catalog_import")
  assert.equal(run?.counts.mode, "plan")
  const plan = t.s.table("PlanItems").rows.filter((r) => r.kind === "catalog_import")
  const byKey = new Map(plan.map((r) => [r.item_key, r]))
  assert.equal(byKey.get("bl:300")?.action, "create")
  assert.deepEqual(
    byKey.get("bl:300")?.changes.map((c: Row) => c.field),
    ["title", "variants", "price", "images", "category", "manufacturer"],
  )
  assert.equal(byKey.get("bl:101")?.action, "update")
  assert.deepEqual(byKey.get("bl:101")?.changes, [{ field: "price:OP-A", from: 300, to: 320 }])
  assert.equal(byKey.get("bl:301")?.action, "conflict")
  assert.equal(byKey.get("bl:301")?.reason, "duplicate_sku")
  assert.ok(plan.every((r) => r.status === "planned" || r.status === "info"), "the writer is not armed")
  assert.ok(!bl.methods().some((m) => !m.startsWith("get")), "no write of any kind")
})

test("live import: product details that cannot be read plan nothing and keep the previous plan", async () => {
  const bl = scriptedBaseLinker({
    getInventoryProductsList: (p) => ({ products: p.page === 1 ? { "101": { sku: "OP-A", name: "A", stock: { bl_1: 1 } } } : {} }),
    getInventoryProductsData: () => ({ status: "ERROR", error_code: "ERROR_BAD_PARAMETERS", error_message: "no" }),
  })
  restore = bl.restore
  const t = setup({ ...live, catalogSource: "baselinker", priceGroupId: 7, stockSync: "off" })
  t.s.table("PlanItems").create({ kind: "catalog_import", item_key: "bl:old", action: "create", status: "planned", demo: false })
  const res = await runCatalogSync(t.container, { trigger: "manual" })
  const run = res.planRuns?.find((r) => r.kind === "catalog_import")
  assert.equal(run?.status, "error")
  assert.equal(t.s.table("PlanItems").rows.length, 1, "the previous plan stays")
})

test("demo import: the simulation shows creates, conflicts and skips; an armed writer applies to the simulation only", async () => {
  const t = setup({ demo: true })
  await writeSetting(t.s.svc, "directions", { catalog: "baselinker", stock: "baselinker" })
  await runCatalogSync(t.container, { trigger: "manual" })
  let plan = t.s.table("PlanItems").rows.filter((r) => r.kind === "catalog_import")
  const labels = (action: string) => plan.filter((r) => r.action === action).map((r) => r.label)
  assert.ok(labels("create").includes("Uchwyt ścienny na narzędzia"))
  assert.ok(labels("create").includes("Rękawice robocze nitrylowe"), "a product only in BaseLinker, with two variants")
  assert.ok(plan.some((r) => r.reason === "duplicate_ean"), "two cards share an EAN")
  assert.ok(plan.some((r) => r.reason === "bundle"))
  assert.ok(plan.some((r) => r.reason === "no_sku"))
  assert.ok(plan.filter((r) => r.action === "create").every((r) => r.status === "planned"))

  await setArm(t.s.svc, "catalogImport", true, { id: "user_1", label: "demo@koda.plus" })
  const second = await runCatalogSync(t.container, { trigger: "manual" })
  plan = t.s.table("PlanItems").rows.filter((r) => r.kind === "catalog_import")
  const created = plan.filter((r) => r.action === "create")
  assert.ok(created.length > 0 && created.every((r) => r.status === "applied"))
  assert.ok((second.planRuns?.find((r) => r.kind === "catalog_import")?.counts.applied as number) > 0)
  const third = await runCatalogSync(t.container, { trigger: "manual" })
  assert.equal(third.planRuns?.find((r) => r.kind === "catalog_import")?.counts.applied, 0, "what the simulation has, it does not apply twice")
  assert.equal(t.events.filter((e) => e.name === "baselinker.plan_applied").length, 1)
})
