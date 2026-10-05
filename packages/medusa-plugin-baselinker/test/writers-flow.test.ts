/**
 * The BaseLinker writers end to end (cards, stock push, price push): plans
 * from a real catalog run, writes only when armed, adoption by SKU before a
 * create, BaseLinker warnings per card, the quarantine and its release.
 * Scripted connector.php, in-memory service, no network.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import type { BaseLinkerPluginOptions } from "../src/modules/baselinker/lib/options.ts"
import { runCatalogSync } from "../src/workflows/baselinker/catalog.ts"
import { releaseQuarantine } from "../src/workflows/baselinker/plans.ts"
import { loadWriters, setArm } from "../src/workflows/baselinker/settings.ts"
import { canArm, writerState } from "../src/modules/baselinker/lib/writers.ts"
import { fakeContainer, fakeQuery, fakeService, scriptedBaseLinker, silentEvents, type Row } from "./fakes.ts"

const variants = [
  { id: "var_a", title: "Default variant", sku: "OP-A", ean: null, product_id: "prod_a", manage_inventory: true, product: { title: "Opona A" }, inventory_items: [{ inventory_item_id: "ii_a", required_quantity: 1 }] },
  { id: "var_b", title: "Default variant", sku: "OP-B", ean: "5901234123457", product_id: "prod_b", manage_inventory: true, product: { title: "Opona B" }, inventory_items: [{ inventory_item_id: "ii_b", required_quantity: 1 }] },
  { id: "var_c", title: "Default variant", sku: "OP-C", ean: null, product_id: "prod_c", manage_inventory: true, product: { title: "Opona C" }, inventory_items: [{ inventory_item_id: "ii_c", required_quantity: 1 }] },
  { id: "var_d", title: "Default variant", sku: "OP-D", ean: null, product_id: "prod_d", manage_inventory: true, product: { title: "Opona D" }, inventory_items: [{ inventory_item_id: "ii_d", required_quantity: 1 }] },
]
const products = variants.map((v) => ({
  id: v.product_id,
  title: v.product.title,
  handle: v.sku.toLowerCase(),
  description: `Opis ${v.sku}`,
  status: "published",
  metadata: {},
  images: [{ url: `https://cdn.example.com/${v.sku}.jpg`, rank: 0 }],
  categories: [],
  tags: [],
  options: [],
  variants: [{ id: v.id, title: v.title, sku: v.sku, ean: v.ean, weight: 8500, manage_inventory: true, prices: [{ amount: 300, currency_code: "pln", rules_count: 0, price_list_id: null }], price_set: { id: `pset_${v.id}` } }],
}))

function setup(options: BaseLinkerPluginOptions, extra: { taxInclusive?: boolean; levels?: Row[] } = {}) {
  const s = fakeService(options)
  const { events, bus } = silentEvents()
  const registry: Record<string, unknown> = {
    baselinker: s.svc,
    query: fakeQuery({
      product_variant: ({ pagination }: Row) => variants.slice(pagination?.skip ?? 0, (pagination?.skip ?? 0) + (pagination?.take ?? 500)),
      product: ({ pagination }: Row) => products.slice(pagination?.skip ?? 0, (pagination?.skip ?? 0) + (pagination?.take ?? 100)),
      product_category: () => [],
      store: () => [{ id: "store_1", default_sales_channel_id: "sc_1" }],
    }),
    stock_location: { listStockLocations: async () => [{ id: "sloc_1" }] },
    inventory: {
      listInventoryLevels: async () =>
        extra.levels ?? [
          { id: "lvl_a", inventory_item_id: "ii_a", stocked_quantity: 4, reserved_quantity: 1 },
          { id: "lvl_b", inventory_item_id: "ii_b", stocked_quantity: 2, reserved_quantity: 0 },
        ],
    },
    pricing: { listPricePreferences: async () => [{ is_tax_inclusive: extra.taxInclusive ?? true }] },
    event_bus: bus,
  }
  return { container: fakeContainer(registry), s, events }
}

const actor = { id: "user_1", label: "anna@example.com" }
const base: BaseLinkerPluginOptions = { apiToken: "t0ken-t0ken-t0ken", inventoryId: 23397, warehouseId: "bl_1", orderStatusId: 1 }

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
})

function listHandler(cards: Record<string, Row>, lookups: Record<string, Record<string, Row>> = {}) {
  return (p: Row) => {
    if (p.filter_sku) return { products: lookups[p.filter_sku] ?? {} }
    return { products: p.page === 1 ? cards : {} }
  }
}

test("cards: nothing is sent until the writer is armed; then create, adopt by SKU, update, and a refusal counts towards quarantine", async () => {
  const bl = scriptedBaseLinker({
    getInventoryProductsList: listHandler(
      { "101": { sku: "OP-A", name: "Opona A (stara nazwa)", stock: { bl_1: 3 } } },
      { "OP-C": { "777": { sku: "op-c", name: "Opona C", stock: { bl_1: 1 } } } },
    ),
    addInventoryProduct: (p) => {
      if (p.product_id) return { product_id: p.product_id, warnings: {} }
      if (p.sku === "OP-D") return { status: "ERROR", error_code: "ERROR_BAD_PARAMETERS", error_message: "ean invalid" }
      return { product_id: 501, warnings: {} }
    },
  })
  restore = bl.restore
  const t = setup({ ...base, stockSync: "off" })

  await runCatalogSync(t.container, { trigger: "manual" })
  assert.ok(!bl.methods().includes("addInventoryProduct"), "a plan only: the writer is not armed")
  let plan = t.s.table("PlanItems").rows.filter((r) => r.kind === "cards")
  assert.deepEqual(
    plan.map((r) => [r.sku, r.action]).sort(),
    [
      ["OP-A", "update"],
      ["OP-B", "create"],
      ["OP-C", "create"],
      ["OP-D", "create"],
    ],
  )

  await setArm(t.s.svc, "cards", true, actor)
  await runCatalogSync(t.container, { trigger: "manual" })
  const adds = bl.calls.filter((c) => c.method === "addInventoryProduct")
  assert.deepEqual(
    adds.map((c) => c.params.sku ?? `update:${c.params.product_id}`).sort(),
    ["OP-B", "OP-D", "update:101"],
    "OP-C was found by SKU and adopted, never created",
  )
  const create = adds.find((c) => c.params.sku === "OP-B")?.params as Row
  assert.deepEqual(create.text_fields, { name: "Opona B", description: "Opis OP-B" })
  assert.equal(create.ean, "5901234123457")
  assert.equal(create.weight, 8.5, "grams to kilograms")
  assert.deepEqual(create.images, { "0": "url:https://cdn.example.com/OP-B.jpg" })
  assert.deepEqual(adds.find((c) => c.params.product_id)?.params, { inventory_id: 23397, product_id: 101, text_fields: { name: "Opona A" } })

  const links = new Map(t.s.table("Products").rows.map((r) => [r.bl_product_id, r.variant_id]))
  assert.equal(links.get("501"), "var_b", "the created card is linked right away")
  assert.equal(links.get("777"), "var_c", "the adopted card is linked")
  plan = t.s.table("PlanItems").rows.filter((r) => r.kind === "cards")
  const bySku = new Map(plan.map((r) => [r.sku, r]))
  assert.equal(bySku.get("OP-C")?.reason, "adopted")
  assert.equal(bySku.get("OP-D")?.status, "failed")
  const q = t.s.table("Quarantines").rows
  assert.equal(q.length, 1)
  assert.equal(q[0].item_key, "variant:var_d")
  assert.equal(q[0].failures, 1)
  assert.equal(q[0].quarantined_at, null)
})

test("stock push: absolute numbers to the bl_ warehouse, warnings fail one card, three failed runs quarantine it, a release brings it back", async () => {
  const sent: Row[] = []
  const bl = scriptedBaseLinker({
    getInventoryProductsList: listHandler({
      "101": { sku: "OP-A", name: "Opona A", stock: { bl_1: 5 } },
      "102": { sku: "OP-B", name: "Opona B", stock: { bl_1: 7 } },
    }),
    updateInventoryProductsStock: (p) => {
      sent.push(p.products)
      return { counter: 1, warnings: p.products["102"] ? { "102": "Product is a bundle" } : {} }
    },
  })
  restore = bl.restore
  const t = setup({ ...base, stockSource: "medusa", stockSync: "write" })
  await runCatalogSync(t.container, { trigger: "manual" })
  assert.equal(sent.length, 0, "not armed")
  let plan = t.s.table("PlanItems").rows.filter((r) => r.kind === "stock_push")
  assert.deepEqual(
    plan.map((r) => [r.sku, r.changes[0].from, r.changes[0].to]).sort(),
    [
      ["OP-A", 5, 3],
      ["OP-B", 7, 2],
    ],
    "available = stocked minus reserved",
  )

  await setArm(t.s.svc, "stockToBaseLinker", true, actor)
  for (let i = 0; i < 3; i += 1) await runCatalogSync(t.container, { trigger: "schedule" })
  assert.deepEqual(sent[0], { "102": { bl_1: 2 }, "101": { bl_1: 3 } }, "decreases first")
  const q = t.s.table("Quarantines").rows[0]
  assert.equal(q.item_key, "card:102")
  assert.ok(q.quarantined_at, "three failed runs")

  sent.length = 0
  await runCatalogSync(t.container, { trigger: "schedule" })
  assert.deepEqual(sent[0], { "101": { bl_1: 3 } }, "the quarantined card is not sent")
  plan = t.s.table("PlanItems").rows.filter((r) => r.kind === "stock_push")
  assert.equal(plan.find((r) => r.sku === "OP-B")?.status, "quarantined")

  assert.equal(await releaseQuarantine(t.s.svc, q.id, "anna@example.com"), true)
  sent.length = 0
  await runCatalogSync(t.container, { trigger: "schedule" })
  assert.ok(sent[0]["102"], "released: tried again")
})

test("stock push: never into a warehouse that is not bl_, and never without stockSync write", async () => {
  const t = setup({ ...base, warehouseId: "shop_5", stockSource: "medusa", stockSync: "write" })
  const { writers } = await loadWriters(t.s.svc)
  assert.equal(writerState(writers, "stockToBaseLinker").configured, false)
  const planOnly = setup({ ...base, stockSource: "medusa", stockSync: "plan" })
  const state = writerState((await loadWriters(planOnly.s.svc)).writers, "stockToBaseLinker")
  assert.equal(state.hardSwitch, "stock_not_write")
  assert.deepEqual(canArm(state), { ok: false, reason: "stock_not_write" })
})

test("prices: the base price goes to the price group; net Medusa prices are grossed up with the card's VAT rate", async () => {
  const sent: Row[] = []
  let group: Row = { price_group_id: 7, name: "Detal", currency: "PLN", source_price_group_id: 0 }
  const handlers = {
    getInventoryProductsList: listHandler({ "101": { sku: "OP-A", name: "Opona A", prices: { "7": 320 }, stock: { bl_1: 3 } } }),
    getInventoryProductsData: () => ({ products: { "101": { sku: "OP-A", tax_rate: 23 } } }),
    getInventoryPriceGroups: () => ({ price_groups: [group] }),
    updateInventoryProductsPrices: (p: Row) => {
      sent.push(p)
      return { counter: 1, warnings: {} }
    },
  }
  const bl = scriptedBaseLinker(handlers)
  restore = bl.restore
  const gross = setup({ ...base, priceGroupId: 7, stockSync: "off" })
  await setArm(gross.s.svc, "prices", true, actor)
  await runCatalogSync(gross.container, { trigger: "manual" })
  assert.deepEqual(sent[0], { inventory_id: 23397, products: { "101": { "7": 300 } } })
  assert.ok(!bl.methods().includes("getInventoryProductsData"), "gross prices need no VAT rate")

  sent.length = 0
  const net = setup({ ...base, priceGroupId: 7, stockSync: "off" }, { taxInclusive: false })
  await setArm(net.s.svc, "prices", true, actor)
  await runCatalogSync(net.container, { trigger: "manual" })
  assert.deepEqual(sent[0].products, { "101": { "7": 369 } }, "300 net at 23 % VAT")

  /* A derived group (BaseLinker computes it) or a group in another currency is never written. */
  for (const wrong of [
    { price_group_id: 7, name: "Allegro", currency: "PLN", source_price_group_id: 3 },
    { price_group_id: 7, name: "Detal EUR", currency: "EUR", source_price_group_id: 0 },
  ]) {
    group = wrong
    sent.length = 0
    const t = setup({ ...base, priceGroupId: 7, stockSync: "off" })
    await setArm(t.s.svc, "prices", true, actor)
    await runCatalogSync(t.container, { trigger: "manual" })
    assert.equal(sent.length, 0, `nothing written into ${wrong.name}`)
    const run = t.s.table("SyncRuns").rows.find((r) => r.kind === "prices")
    assert.equal(run?.status, "error")
    assert.match(String(run?.message), /nothing was written/)
    assert.ok(t.s.table("PlanItems").rows.some((r) => r.kind === "prices"), "the plan stays for reading")
  }
})

test("a hard switch in the options wins: the writer cannot be armed and nothing is written", async () => {
  const bl = scriptedBaseLinker({
    getInventoryProductsList: listHandler({ "101": { sku: "OP-A", name: "Opona A", prices: { "7": 320 }, stock: { bl_1: 3 } } }),
    updateInventoryProductsPrices: () => ({ counter: 1, warnings: {} }),
  })
  restore = bl.restore
  const t = setup({ ...base, priceGroupId: 7, stockSync: "off", writers: { prices: false } })
  await setArm(t.s.svc, "prices", true, actor)
  const state = writerState((await loadWriters(t.s.svc)).writers, "prices")
  assert.equal(state.allowed, false)
  assert.equal(state.live, false)
  assert.deepEqual(canArm(state), { ok: false, reason: "hard_off" })
  await runCatalogSync(t.container, { trigger: "manual" })
  assert.ok(!bl.methods().includes("updateInventoryProductsPrices"))
})

test("arming records who and when; demo arms never arm a real account", async () => {
  const demo = setup({ demo: true })
  await setArm(demo.s.svc, "cards", true, actor)
  const state = writerState((await loadWriters(demo.s.svc)).writers, "cards")
  assert.equal(state.armed, true)
  assert.equal(state.changedByLabel, "anna@example.com")
  assert.ok(state.changedAt)
  assert.equal(demo.s.table("Settings").rows[0].demo, true, "an arm belongs to its mode")
})
