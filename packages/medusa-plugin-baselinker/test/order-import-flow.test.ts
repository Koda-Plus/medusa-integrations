/**
 * Marketplace orders from BaseLinker into Medusa, end to end: the real
 * discovery, import pass and status read against an in-memory service, a
 * scripted connector.php and stand-ins for Medusa's order workflows (the
 * seam `setOrderOpsForTests`). Exactly once is checked across a crash.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import type { BaseLinkerPluginOptions } from "../src/modules/baselinker/lib/options.ts"
import { importOrderNow, runOrderImport, setOrderOpsForTests, syncImportedStatuses } from "../src/workflows/baselinker/order-import.ts"
import { sendOrderNow } from "../src/workflows/baselinker/orders.ts"
import { setArm } from "../src/workflows/baselinker/settings.ts"
import { fakeContainer, fakeService, matches, scriptedBaseLinker, silentEvents, type Row } from "./fakes.ts"

interface MedusaOrder {
  id: string
  display_id: number
  status: string
  email?: string
  metadata: Row
  items: Array<{ id: string; quantity: number; detail: { quantity: number; fulfilled_quantity: number } }>
  payment_collections: Array<{ id: string; status: string }>
}

function setup(options: BaseLinkerPluginOptions, opts: { ignoreJsonFilter?: boolean; afterLookup?: (key: string, orders: MedusaOrder[]) => void } = {}) {
  const s = fakeService(options)
  const { events, bus } = silentEvents()
  const orders: MedusaOrder[] = []
  const calls: string[] = []
  const graph = async ({ entity, filters }: Row) => {
    if (entity === "region") return { data: [{ id: "reg_pl", currency_code: "pln" }] }
    if (entity === "store") return { data: [{ id: "store_1", default_sales_channel_id: "sc_1" }] }
    if (entity !== "order") return { data: [] }
    if (filters?.metadata) {
      const [[key, value]] = Object.entries(filters.metadata as Row)
      const found = opts.ignoreJsonFilter ? orders.slice(0, 5) : orders.filter((o) => o.metadata?.[key] === value)
      const answer = { data: [...found] }
      opts.afterLookup?.(key, orders)
      return answer
    }
    if (filters?.id) return { data: orders.filter((o) => o.id === filters.id) }
    return { data: orders.filter((o) => matches(o as unknown as Row, {})) }
  }
  const registry: Record<string, unknown> = { baselinker: s.svc, query: { graph }, event_bus: bus }
  let seq = 0
  setOrderOpsForTests({
    async create(_scope, input) {
      calls.push("create")
      seq += 1
      const items = (input.items as Row[]).map((i, n) => ({ id: `item_${seq}_${n}`, quantity: i.quantity, detail: { quantity: i.quantity, fulfilled_quantity: 0 } }))
      const order: MedusaOrder = { id: `order_${seq}`, display_id: 1000 + seq, status: "draft", metadata: input.metadata as Row, items, payment_collections: [] }
      assert.equal((input as Row).email, undefined, "never an e-mail into the order workflow")
      orders.push(order)
      return { id: order.id, display_id: order.display_id }
    },
    async setEmail(_scope, orderId, email) {
      calls.push("setEmail")
      const o = orders.find((x) => x.id === orderId) as MedusaOrder
      assert.equal(o.status, "draft", "the e-mail is set before the order is placed")
      o.email = email
    },
    async place(_scope, orderId) {
      calls.push("place")
      ;(orders.find((x) => x.id === orderId) as MedusaOrder).status = "pending"
    },
    async paymentCollections(_scope, orderId) {
      return (orders.find((x) => x.id === orderId) as MedusaOrder).payment_collections
    },
    async createPaymentCollection(_scope, orderId) {
      calls.push("paymentCollection")
      const pc = { id: `paycol_${orderId}`, status: "not_paid" }
      ;(orders.find((x) => x.id === orderId) as MedusaOrder).payment_collections.push(pc)
      return pc
    },
    async markPaid(_scope, orderId, id) {
      calls.push("markPaid")
      const pc = (orders.find((x) => x.id === orderId) as MedusaOrder).payment_collections.find((p) => p.id === id)
      if (pc) pc.status = "paid"
    },
    async cancel(_scope, orderId) {
      calls.push("cancel")
      ;(orders.find((x) => x.id === orderId) as MedusaOrder).status = "canceled"
    },
  })
  return { container: fakeContainer(registry), s, events, orders, calls }
}

let restore: (() => void) | null = null
afterEach(() => {
  restore?.()
  restore = null
  setOrderOpsForTests(null)
})

const nowUnix = () => Math.floor(Date.now() / 1000)

function blOrder(id: number, over: Row = {}): Row {
  return {
    order_id: id,
    external_order_id: `ext-${id}`,
    order_source: "allegro",
    order_source_id: 1455,
    order_status_id: 1,
    confirmed: true,
    date_confirmed: nowUnix() - 600 + id % 100,
    currency: "PLN",
    payment_method_cod: "0",
    payment_done: 69.99,
    email: `buyer${id}@example.com`,
    delivery_method: "InPost",
    delivery_price: 9.99,
    delivery_fullname: "Anna Nowak",
    delivery_address: "ul. Przykładowa 1",
    delivery_postcode: "00-001",
    delivery_city: "Warszawa",
    delivery_country_code: "PL",
    products: [{ order_product_id: id, product_id: "101", variant_id: "0", name: "Opona", sku: "OP-A", price_brutto: 60, tax_rate: 23, quantity: 1 }],
    ...over,
  }
}

function fakeAccount(held: Row[]) {
  return scriptedBaseLinker({
    getOrders: (p) => {
      if (p.order_id) return { orders: held.filter((o) => o.order_id === p.order_id) }
      return {
        orders: held
          .filter((o) => o.date_confirmed >= p.date_confirmed_from)
          .filter((o) => !p.filter_order_source || o.order_source === p.filter_order_source)
          .sort((a, b) => a.date_confirmed - b.date_confirmed)
          .slice(0, 100),
      }
    },
    getOrderStatusList: () => ({ statuses: [{ id: 1, name: "Nowe" }, { id: 9, name: "Anulowane" }] }),
  })
}

const live: BaseLinkerPluginOptions = { apiToken: "t0ken-t0ken-t0ken", inventoryId: 1, warehouseId: "bl_1", orderStatusId: 1, customSourceId: 77, orderImportSources: ["allegro"] }
const actor = { id: "user_1", label: "anna@example.com" }

test("discovery: pending rows for the chosen sources only, our own exports never; nothing is created before the writer is armed", async () => {
  const bl = fakeAccount([
    blOrder(1),
    blOrder(2, { admin_comments: "[medusa:order_01JX] Medusa #5" }),
    blOrder(3, { order_source: "amazon", order_source_id: 9 }),
    blOrder(4, { order_source: "personal", order_source_id: 77 }),
  ])
  restore = bl.restore
  const t = setup(live)
  const stats = await runOrderImport(t.container, "schedule")
  assert.equal(stats?.created, 1)
  assert.equal(stats?.armed, false)
  assert.equal(stats?.waiting, 1)
  assert.equal(bl.calls[0].params.filter_order_source, "allegro", "one source: filtered by BaseLinker")
  assert.equal(t.calls.length, 0, "no Medusa order without the writer")
  const rows = t.s.table("Imports").rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].bl_order_id, "1")
  assert.equal(rows[0].marketplace_ref, "allegro:ext-1")
  assert.equal(rows[0].total_minor, 6999)
  assert.ok(!JSON.stringify(rows).includes("Nowak"), "no buyer data on the import row")
  await runOrderImport(t.container, "schedule")
  assert.equal(t.s.table("Imports").rows.length, 1, "the cursor and the unique row keep it single")
})

test("armed: one Medusa order per BaseLinker order, e-mail before placing, a paid collection for a paid order, never twice", async () => {
  const bl = fakeAccount([blOrder(1), blOrder(2, { payment_done: 0, payment_method_cod: "1" })])
  restore = bl.restore
  const t = setup(live)
  t.s.table("Products").create({ bl_product_id: "101", variant_id: "var_a", conflict: null, demo: false })
  await setArm(t.s.svc, "orderImport", true, actor)
  const stats = await runOrderImport(t.container, "schedule")
  assert.equal(stats?.imported, 2)
  assert.equal(t.orders.length, 2)
  assert.deepEqual(t.calls.filter((c) => c === "create").length, 2)
  const paid = t.orders.find((o) => o.metadata.baselinker_order_id === "1") as MedusaOrder
  assert.equal(paid.status, "pending")
  assert.equal(paid.email, "buyer1@example.com")
  assert.equal(paid.payment_collections[0].status, "paid")
  const cod = t.orders.find((o) => o.metadata.baselinker_order_id === "2") as MedusaOrder
  assert.equal(cod.payment_collections[0].status, "not_paid", "cash on delivery is not paid yet")
  const rows = t.s.table("Imports").rows
  assert.ok(rows.every((r) => r.status === "imported" && r.order_id))
  assert.equal(t.events.filter((e) => e.name === "baselinker.order_imported").length, 2)

  await runOrderImport(t.container, "schedule")
  assert.equal(t.orders.length, 2, "a second pass creates nothing")
})

test("a crash after the order exists: the retry finishes it and never makes a second one", async () => {
  const bl = fakeAccount([blOrder(1)])
  restore = bl.restore
  const t = setup(live)
  await setArm(t.s.svc, "orderImport", true, actor)
  let fail = true
  setOrderOpsForTests({
    async create(_s, input) {
      const order = { id: "order_x", display_id: 7, status: "draft", metadata: input.metadata as Row, items: [], payment_collections: [] }
      t.orders.push(order as never)
      return order
    },
    async setEmail() {},
    async place() {
      if (fail) throw Object.assign(new Error("connection terminated"), { type: "db_error" })
      ;(t.orders[0] as MedusaOrder).status = "pending"
    },
    async paymentCollections() {
      return []
    },
    async createPaymentCollection() {
      return { id: "pc", status: "not_paid" }
    },
    async markPaid() {},
  })
  const first = await runOrderImport(t.container, "schedule")
  assert.equal(first?.retry, 1)
  const row = t.s.table("Imports").rows[0]
  assert.equal(row.order_id, "order_x", "the Medusa order id is stored the moment it exists")
  assert.equal(row.status, "pending")

  fail = false
  row.next_attempt_at = new Date(Date.now() - 1000)
  const second = await runOrderImport(t.container, "schedule")
  assert.equal(second?.imported, 1)
  assert.equal(t.orders.length, 1, "no second Medusa order")
  assert.equal(t.s.table("Imports").rows[0].status, "imported")
})

test("lookups before create: a Medusa order with this BaseLinker id is adopted; one with the same marketplace reference wins", async () => {
  const bl = fakeAccount([blOrder(1), blOrder(2)])
  restore = bl.restore
  const t = setup(live)
  t.orders.push({ id: "order_old", display_id: 77, status: "pending", metadata: { baselinker_order_id: "1", baselinker_imported: true }, items: [], payment_collections: [] })
  t.orders.push({ id: "order_allegro", display_id: 78, status: "pending", metadata: { marketplace_order_ref: "allegro:ext-2" }, items: [], payment_collections: [] })
  await setArm(t.s.svc, "orderImport", true, actor)
  const stats = await runOrderImport(t.container, "schedule")
  assert.equal(stats?.adopted, 1)
  assert.equal(stats?.skipped, 1)
  assert.ok(!t.calls.includes("create"))
  const byId = new Map(t.s.table("Imports").rows.map((r) => [r.bl_order_id, r]))
  assert.equal(byId.get("1")?.order_id, "order_old")
  assert.equal(byId.get("2")?.status, "skipped")
  assert.equal(byId.get("2")?.last_error_code, "duplicate_marketplace_ref")
  assert.match(String(byId.get("2")?.last_error), /#78/)
})

test("a race with another plugin: the order it creates right after our first lookup is found again under the shared lock", async () => {
  const bl = fakeAccount([blOrder(2)])
  restore = bl.restore
  let refLookups = 0
  const t = setup(live, {
    afterLookup: (key, orders) => {
      if (key !== "marketplace_order_ref") return
      refLookups += 1
      /* The Allegro plugin creates the same marketplace order just after our first look. */
      if (refLookups === 1) orders.push({ id: "order_allegro", display_id: 79, status: "pending", metadata: { marketplace_order_ref: "allegro:ext-2" }, items: [], payment_collections: [] })
    },
  })
  await setArm(t.s.svc, "orderImport", true, actor)
  const stats = await runOrderImport(t.container, "schedule")
  assert.equal(refLookups, 2, "looked up before mapping and again inside the lock")
  assert.equal(stats?.skipped, 1)
  assert.ok(!t.calls.includes("create"), "never a second Medusa order")
  const row = t.s.table("Imports").rows[0]
  assert.equal(row.last_error_code, "duplicate_marketplace_ref")
  assert.match(String(row.last_error), /#79/)
})

test("an ignored JSON filter does not fool the lookup: the orders are scanned instead", async () => {
  const bl = fakeAccount([blOrder(2)])
  restore = bl.restore
  const t = setup(live, { ignoreJsonFilter: true })
  for (let i = 0; i < 5; i += 1) t.orders.push({ id: `order_${i}`, display_id: i, status: "pending", metadata: {}, items: [], payment_collections: [] })
  t.orders.push({ id: "order_allegro", display_id: 78, status: "pending", metadata: { marketplace_order_ref: "allegro:ext-2" }, items: [], payment_collections: [] })
  await setArm(t.s.svc, "orderImport", true, actor)
  const stats = await runOrderImport(t.container, "schedule")
  assert.equal(stats?.skipped, 1)
  assert.ok(!t.calls.includes("create"))
})

test("an order older than orderImportMaxAgeHours waits for a person; Retry imports it", async () => {
  const bl = fakeAccount([blOrder(1, { date_confirmed: nowUnix() - 5 * 3600 })])
  restore = bl.restore
  const t = setup({ ...live, orderImportMaxAgeHours: 2, orderImportSince: new Date(Date.now() - 10 * 3600 * 1000).toISOString() })
  await setArm(t.s.svc, "orderImport", true, actor)
  await runOrderImport(t.container, "schedule")
  const row = t.s.table("Imports").rows[0]
  assert.equal(row.status, "skipped")
  assert.equal(row.last_error_code, "too_old")
  const out = await importOrderNow(t.container, row.id)
  assert.equal(out.status, "imported")
  assert.equal(t.orders.length, 1)
})

test("statuses: cancelled in BaseLinker cancels the Medusa order while nothing is fulfilled, and flags it otherwise; a later payment follows", async () => {
  const held = [blOrder(1, { payment_done: 0 }), blOrder(2)]
  const bl = fakeAccount(held)
  restore = bl.restore
  const t = setup({ ...live, orderImportCancelStatusIds: [9] })
  await setArm(t.s.svc, "orderImport", true, actor)
  await runOrderImport(t.container, "schedule")
  assert.equal(t.orders.length, 2)
  ;(t.orders.find((o) => o.metadata.baselinker_order_id === "2") as MedusaOrder).items[0].detail.fulfilled_quantity = 1
  held[0].order_status_id = 1
  held[0].payment_done = 69.99
  held[1].order_status_id = 9
  const stats = await syncImportedStatuses(t.container, "manual")
  assert.equal(stats?.paid, 1)
  assert.equal(stats?.flagged, 1)
  const byId = new Map(t.s.table("Imports").rows.map((r) => [r.bl_order_id, r]))
  assert.equal(byId.get("1")?.payment_state, "paid")
  assert.equal(byId.get("2")?.flag, "cancel_blocked")
  assert.notEqual((t.orders.find((o) => o.metadata.baselinker_order_id === "2") as MedusaOrder).status, "canceled", "fulfilled: never cancelled by the plugin")

  held[0].order_status_id = 9
  const again = await syncImportedStatuses(t.container, "manual")
  assert.equal(again?.canceled, 1)
  assert.equal(again?.flagged, 0, "a flag is raised once")
  assert.equal((t.orders.find((o) => o.metadata.baselinker_order_id === "1") as MedusaOrder).status, "canceled")
})

test("the loop guard on the way out: an imported order never goes to BaseLinker", async () => {
  const bl = scriptedBaseLinker({ getOrders: () => ({ orders: [] }) })
  restore = bl.restore
  const s = fakeService({ ...live })
  const order = { id: "order_imp", display_id: 9, status: "pending", created_at: new Date().toISOString(), metadata: { baselinker_imported: true, baselinker_order_id: "1" }, items: [] }
  const container = fakeContainer({
    baselinker: s.svc,
    query: { graph: async ({ filters }: Row) => ({ data: filters?.id === order.id ? [order] : [] }) },
    event_bus: silentEvents().bus,
  })
  s.table("Orders").create({ order_id: order.id, status: "pending", attempts: 0, demo: false, display_id: 9 })
  const out = await sendOrderNow(container, order.id)
  assert.equal(out.status, "skipped")
  assert.ok(!bl.methods().includes("addOrder"))
  assert.match(String(s.table("Orders").rows[0].last_error), /came from BaseLinker/)
})

test("demo: simulated Allegro and Amazon orders are found, and become Medusa orders once the writer is armed", async () => {
  const t = setup({ demo: true })
  for (let i = 0; i < 6; i += 1) t.s.table("Products").create({ bl_product_id: String(500 + i), sku: `KS-${i}`, name: `Produkt ${i}`, variant_id: `var_${i}`, conflict: null, price: { "1001": 10 + i }, demo: true })
  const realNow = Date.now
  /* Late in the day, so the simulated day has its orders. */
  const fixed = new Date()
  fixed.setUTCHours(22, 0, 0, 0)
  Date.now = () => fixed.getTime()
  try {
    const first = await runOrderImport(t.container, "manual")
    assert.ok((first?.created ?? 0) >= 1)
    assert.equal(t.orders.length, 0)
    await setArm(t.s.svc, "orderImport", true, actor)
    const second = await runOrderImport(t.container, "manual")
    assert.ok((second?.imported ?? 0) >= 1)
    assert.ok(t.orders.every((o) => String(o.email).endsWith("@example.com")))
    assert.ok(t.orders.every((o) => o.metadata.baselinker_imported === true && o.metadata.marketplace_order_ref))
    assert.ok(t.s.table("Imports").rows.every((r) => r.demo === true))
  } finally {
    Date.now = realNow
  }
})
