/**
 * The order outbox end to end: the real `sendOrderNow` (rows, lock, payload,
 * marker scan, client, retries, metadata, events) against an in-memory
 * service, a fake Medusa container and a scripted connector.php. No network:
 * `fetch` is replaced for the duration of each test and refuses any other URL.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import type { BaseLinkerPluginOptions } from "../src/modules/baselinker/lib/options.ts"
import { sendDueOrders, sendOrderNow } from "../src/workflows/baselinker/orders.ts"
import orderPlaced from "../src/subscribers/baselinker-order-placed.ts"
import { fakeService } from "./fakes.ts"

type Row = Record<string, any>

const TOKEN = "5012345-5067890-QWERTYUIOPASDFGHJKLZXCVBNM1234567890ABCDEFGHIJKLMNOP"

function setup(options: BaseLinkerPluginOptions, order: Row, extra: Record<string, unknown> = {}, graph?: (args: Row) => Row[]) {
  const f = fakeService(options)
  const orders = f.table("Orders")
  const products = f.table("Products")
  const settings = f.table("Settings")
  const imports = f.table("Imports")
  const events: Array<{ name: string; data: Row }> = []
  const metadata: Row = { ...(order.metadata ?? {}) }
  const registry: Record<string, unknown> = {
    baselinker: f.svc,
    query: {
      graph: async (args: Row) => {
        if (graph) return { data: graph(args) }
        return { data: args.entity === "order" && args.filters?.id === order.id ? [{ ...order, metadata: { ...metadata } }] : [] }
      },
    },
    order: {
      retrieveOrder: async (id: string) => ({ id, metadata: { ...metadata } }),
      updateOrders: async (_id: string, data: Row) => {
        Object.assign(metadata, data.metadata)
      },
    },
    event_bus: { emit: async (e: { name: string; data: Row }) => void events.push(e) },
    ...extra,
  }
  const container = {
    resolve: (key: string) => {
      if (!(key in registry)) throw new Error(`not registered: ${key}`)
      return registry[key]
    },
  }
  return { container, orders, products, settings, imports, events, metadata, logs: f.logs }
}

/** A scripted connector.php that remembers the orders it holds. */
function fakeBaseLinker(addOrder: "ok" | "lost_answer" | "no_answer" | "bad_params") {
  const held: Array<{ order_id: number; admin_comments: string }> = []
  const calls: Array<{ method: string; params: Row }> = []
  let next = 7000
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (String(url) !== "https://api.baselinker.com/connector.php") throw new Error(`unexpected URL ${String(url)}`)
    const body = new URLSearchParams(String(init?.body ?? ""))
    const method = body.get("method") ?? ""
    const params = JSON.parse(body.get("parameters") ?? "{}") as Row
    calls.push({ method, params })
    if (method === "getOrders") return reply({ status: "SUCCESS", orders: held.filter((o) => params.id_from === undefined || o.order_id >= params.id_from) })
    if (method === "addOrder") {
      if (addOrder === "bad_params") return reply({ status: "ERROR", error_code: "ERROR_BAD_PARAMETERS", error_message: "products: required" })
      next += 1
      if (addOrder !== "no_answer") held.push({ order_id: next, admin_comments: String(params.admin_comments) })
      if (addOrder === "lost_answer" || addOrder === "no_answer") throw new TypeError("fetch failed")
      return reply({ status: "SUCCESS", order_id: next })
    }
    return reply({ status: "ERROR", error_code: "ERROR_UNKNOWN_METHOD" })
  }) as typeof fetch
  return { held, calls, fetchImpl, methods: () => calls.map((c) => c.method) }
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const order: Row = {
  id: "order_01JTEST0000000000000000001",
  display_id: 1042,
  email: "anna@example.com",
  currency_code: "pln",
  created_at: "2026-10-05T09:15:00.000Z",
  status: "pending",
  metadata: {},
  total: 120,
  shipping_total: 20,
  items: [{ id: "ordli_1", title: "Opona", variant_id: "variant_1", variant_sku: "OP-1", detail: { quantity: 2 }, total: 100, tax_lines: [{ rate: 23 }] }],
  shipping_methods: [{ name: "InPost", amount: 20 }],
  payment_collections: [],
}

const live: BaseLinkerPluginOptions = { apiToken: TOKEN, inventoryId: 23397, warehouseId: "bl_1", orderStatusId: 122665 }

test("demo: the order gets a simulated BaseLinker id in the plugin's row only, never in its metadata, and no event", async () => {
  const s = setup({ demo: true }, order)
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "sent")
  assert.equal(out.blOrderId, "9100001")
  assert.equal(s.orders.rows[0].status, "sent")
  assert.equal(s.orders.rows[0].demo, true)
  assert.equal(s.metadata.baselinker_order_id, undefined, "a real order never gets a simulated number")
  assert.equal(s.events.length, 0, "no event for a simulation")
  assert.equal((await sendOrderNow(s.container, order.id)).blOrderId, "9100001", "never twice")
})

test("live: scan first, one addOrder, the linked card on the line, the marker in admin_comments", async () => {
  const bl = fakeBaseLinker("ok")
  globalThis.fetch = bl.fetchImpl
  const s = setup(live, order)
  s.products.rows.push({ id: "blprod_1", variant_id: "variant_1", bl_product_id: "232696614", conflict: null, demo: false })
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "sent")
  assert.equal(out.adopted, false)
  assert.deepEqual(bl.methods(), ["getOrders", "addOrder"])
  const payload = bl.calls[1].params
  assert.ok(String(payload.admin_comments).startsWith(`[medusa:${order.id}]`))
  assert.deepEqual(payload.products[0], {
    storage: "db",
    storage_id: 23397,
    product_id: "232696614",
    name: "Opona",
    sku: "OP-1",
    price_brutto: 50,
    tax_rate: 23,
    quantity: 2,
  })
  assert.equal(s.metadata.baselinker_order_id, String(out.blOrderId))
})

test("live: an answer lost after addOrder is settled by a second scan, not a second order", async () => {
  const bl = fakeBaseLinker("lost_answer")
  globalThis.fetch = bl.fetchImpl
  const s = setup(live, order)
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "sent")
  assert.equal(out.adopted, true)
  assert.deepEqual(bl.methods(), ["getOrders", "addOrder", "getOrders"])
  assert.equal(bl.held.length, 1)
})

test("live: an unknown result waits, and the next attempt adopts instead of writing again", async () => {
  const bl = fakeBaseLinker("no_answer")
  globalThis.fetch = bl.fetchImpl
  const s = setup(live, order)
  const first = await sendOrderNow(s.container, order.id)
  assert.equal(first.status, "retry")
  assert.equal(first.code, "unknown_result")
  assert.equal(s.orders.rows[0].status, "pending")
  assert.ok(new Date(s.orders.rows[0].next_attempt_at).getTime() > Date.now())

  /* BaseLinker committed the order late. */
  bl.held.push({ order_id: 7777, admin_comments: `[medusa:${order.id}] Medusa #1042` })
  const second = await sendOrderNow(s.container, order.id)
  assert.equal(second.status, "sent")
  assert.equal(second.blOrderId, "7777")
  assert.equal(bl.methods().filter((m) => m === "addOrder").length, 1)
})

test("live: a permanent refusal fails at once and tells the event bus", async () => {
  const bl = fakeBaseLinker("bad_params")
  globalThis.fetch = bl.fetchImpl
  const s = setup(live, order)
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "failed")
  assert.equal(s.orders.rows[0].last_error_code, "ERROR_BAD_PARAMETERS")
  assert.equal(s.events.at(-1)?.name, "baselinker.order_failed")
})

test("test orders and canceled orders stay out, unless an earlier attempt already reached BaseLinker", async () => {
  const bl = fakeBaseLinker("ok")
  globalThis.fetch = bl.fetchImpl
  const skipped = setup(live, { ...order, metadata: { baselinker_skip: true } })
  assert.equal((await sendOrderNow(skipped.container, order.id)).status, "skipped")
  assert.equal(bl.calls.length, 0)

  const canceled = { ...order, status: "canceled" }
  const s = setup(live, canceled)
  s.orders.rows.push({ id: "blord_9", order_id: order.id, demo: false, status: "pending", attempts: 1, bl_order_id: null, display_id: 1042 })
  bl.held.push({ order_id: 7100, admin_comments: `[medusa:${order.id}]` })
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "sent")
  assert.equal(out.code, "stopped_after_send")
  assert.equal(s.orders.rows[0].bl_order_id, "7100")
  assert.equal(bl.methods().includes("addOrder"), false)
})

test("a second sender of the same order is turned away while another process holds its lease", async () => {
  const s = setup({ demo: true }, order)
  /* Another process (the worker, while this is the server) holds the order. */
  s.settings.rows.push({ id: "blset_other", key: `lease:lock:baselinker:order:${order.id}`, demo: true, value: { owner: "other", until: new Date(Date.now() + 60_000).toISOString() } })
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "busy")
  assert.equal(s.orders.rows.length, 0)
  assert.equal(s.settings.rows.length, 1, "the other holder's lease stays")
})

test("a lease whose process died is taken over, and the lease is gone after the send", async () => {
  const s = setup({ demo: true }, order)
  s.settings.rows.push({ id: "blset_dead", key: `lease:lock:baselinker:order:${order.id}`, demo: true, value: { owner: "dead", until: new Date(Date.now() - 1000).toISOString() } })
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "sent")
  assert.equal(s.settings.rows.length, 0)
})

test("a lock store that does not answer is an error, never a quiet busy", async () => {
  const s = setup({ demo: true }, order)
  const svc = s.container.resolve("baselinker") as Record<string, unknown>
  const original = svc.listBaseLinkerSettings
  ;(svc as Record<string, unknown>).listBaseLinkerSettings = async () => {
    throw new Error("connection refused")
  }
  await assert.rejects(() => sendOrderNow(s.container, order.id), (err: Error & { code?: string }) => err.code === "lock_unavailable")
  ;(svc as Record<string, unknown>).listBaseLinkerSettings = original
})

test("the queue reads the row again under the lease: a row another process sent a moment ago gets no extra attempt", async () => {
  const bl = fakeBaseLinker("ok")
  globalThis.fetch = bl.fetchImpl
  const s = setup(live, order)
  s.orders.rows.push({ id: "blord_1", order_id: order.id, demo: false, status: "pending", attempts: 0, next_attempt_at: new Date(Date.now() - 1000), bl_order_id: null, display_id: 1042, created_at: new Date() })
  const svc = s.container.resolve("baselinker") as Record<string, (...a: unknown[]) => Promise<unknown>>
  const list = svc.listBaseLinkerOrders
  let first = true
  svc.listBaseLinkerOrders = async (...args: unknown[]) => {
    const rows = (await list(...args)) as Row[]
    if (first) {
      first = false
      /* Between the list of due rows and the lock, another process sent the order. */
      Object.assign(s.orders.rows[0], { status: "sent", bl_order_id: "7001", next_attempt_at: null })
    }
    return rows
  }
  const stats = await sendDueOrders(s.container, "schedule")
  assert.equal(stats?.sent, 0)
  assert.equal(stats?.busy, 1)
  assert.equal(bl.calls.length, 0, "nothing went to BaseLinker")
  assert.equal(s.orders.rows[0].attempts, 0)
})

test("one run of the queue across processes: a live job lease elsewhere makes this pass step aside", async () => {
  const s = setup(live, order)
  s.settings.rows.push({ id: "blset_job", key: "lease:job:orders", demo: false, value: { owner: "worker", until: new Date(Date.now() + 60_000).toISOString() } })
  assert.equal(await sendDueOrders(s.container, "manual"), null)
})

test("totals Medusa cannot compute: the order is read without them and sent with totals from its lines", async () => {
  const bl = fakeBaseLinker("ok")
  globalThis.fetch = bl.fetchImpl
  const lines: Row = {
    ...order,
    total: undefined,
    shipping_total: undefined,
    items: [{ id: "ordli_1", title: "Opona", variant_id: "variant_1", variant_sku: "OP-1", detail: { quantity: 2 }, unit_price: 50, is_tax_inclusive: true, adjustments: [{ amount: 10 }], tax_lines: [{ rate: 23 }] }],
    shipping_methods: [{ name: "Kurier", amount: 16.26, is_tax_inclusive: false, tax_lines: [{ rate: 23 }] }],
    payment_collections: [{ status: "authorized", amount: 110, payments: [{ provider_id: "pp_stripe_stripe", amount: 110, captured_at: "2026-10-05T09:16:00.000Z" }] }],
  }
  const asked: string[][] = []
  const s = setup(live, order, {}, (args) => {
    asked.push(args.fields ?? [])
    if (args.entity !== "order") return []
    if ((args.fields ?? []).includes("total")) throw new Error("Shipping method with id osm_1 has no version")
    return [lines]
  })
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "sent")
  const payload = bl.calls.find((c) => c.method === "addOrder")?.params as Row
  assert.equal(payload.products[0].price_brutto, 45, "(2 x 50 - 10) / 2")
  assert.equal(payload.delivery_price, 20, "16.26 net plus 23 percent")
  assert.match(String(payload.admin_comments), /totals computed from the lines/)
  assert.equal(payload.paid, 1, "captured 110 covers the computed 110 and the collection")
  assert.ok(asked.some((f) => !f.includes("total") && f.includes("items.adjustments.*")))
})

test("totals from lines never mark an order paid when the capture covers less than the collection", async () => {
  const bl = fakeBaseLinker("ok")
  globalThis.fetch = bl.fetchImpl
  const lines: Row = {
    ...order,
    items: [{ id: "ordli_1", title: "Opona", detail: { quantity: 1 }, unit_price: 100, is_tax_inclusive: true }],
    shipping_methods: [],
    payment_collections: [{ status: "authorized", amount: 150, payments: [{ provider_id: "pp_stripe_stripe", amount: 100, captured_at: "2026-10-05T09:16:00.000Z" }] }],
  }
  const s = setup(live, order, {}, (args) => {
    if ((args.fields ?? []).includes("total")) throw new Error("no version")
    return args.entity === "order" ? [lines] : []
  })
  assert.equal((await sendOrderNow(s.container, order.id)).status, "sent")
  assert.equal((bl.calls.find((c) => c.method === "addOrder")?.params as Row).paid, 0)
})

test("when the order cannot be read with or without totals, the row waits with totals_unavailable", async () => {
  const bl = fakeBaseLinker("ok")
  globalThis.fetch = bl.fetchImpl
  const s = setup(live, order, {}, () => {
    throw new Error("database is down")
  })
  s.orders.rows.push({ id: "blord_1", order_id: order.id, demo: false, status: "pending", attempts: 0, next_attempt_at: new Date(), bl_order_id: null, display_id: 1042 })
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "retry")
  assert.equal(out.code, "totals_unavailable")
  assert.equal(bl.calls.length, 0)
})

test("metadata a shopper can set decides nothing: baselinker_imported without an import row still goes, with one it stays out", async () => {
  const bl = fakeBaseLinker("ok")
  globalThis.fetch = bl.fetchImpl
  const forged = { ...order, metadata: { baselinker_imported: true, baselinker_order_id: "9999" } }
  const a = setup(live, forged)
  assert.equal((await sendOrderNow(a.container, order.id)).status, "sent")

  const b = setup(live, order)
  b.imports.rows.push({ id: "blimp_1", bl_order_id: "8001", order_id: order.id, demo: false, status: "imported" })
  const out = await sendOrderNow(b.container, order.id)
  assert.equal(out.status, "skipped")
  assert.equal(out.code, "imported")
})

test("a marketplace reference counts only on an order backend code created: from a cart it is the shopper's word", async () => {
  const bl = fakeBaseLinker("ok")
  globalThis.fetch = bl.fetchImpl
  const ref = { ...order, metadata: { marketplace_order_ref: "allegro:abc" } }
  const fromCart = setup(live, ref, {}, (args) => (args.entity === "order" ? [{ ...ref, cart: { id: "cart_1" } }] : []))
  assert.equal((await sendOrderNow(fromCart.container, order.id)).status, "sent")

  const fromBackend = setup(live, ref)
  const out = await sendOrderNow(fromBackend.container, order.id)
  assert.equal(out.status, "skipped")
  assert.equal(out.code, "marketplace_order")
  assert.equal(fromBackend.orders.rows[0].last_error_code, "marketplace_order")
})

test("order.placed queues the order even when the import table cannot be read right now; the send decides again", async () => {
  const s = setup({ demo: true }, order)
  const svc = s.container.resolve("baselinker") as Record<string, unknown>
  svc.listBaseLinkerImports = async () => {
    throw new Error("connection terminated")
  }
  await orderPlaced({ event: { data: { id: order.id } }, container: s.container } as never)
  assert.equal(s.orders.rows.length, 1, "the row is there")
  assert.equal(s.orders.rows[0].order_id, order.id)
  /* The background send runs into the same failure and waits for a retry instead of sending blindly. */
  await new Promise((r) => setTimeout(r, 50))
  assert.notEqual(s.orders.rows[0].status, "sent")
})

test("order.placed: an order this plugin imported gets no row; a test order gets a skipped row with its code", async () => {
  const imported = setup({ demo: true }, order)
  imported.imports.rows.push({ id: "blimp_1", bl_order_id: "8001", order_id: order.id, demo: true, status: "imported" })
  await orderPlaced({ event: { data: { id: order.id } }, container: imported.container } as never)
  assert.equal(imported.orders.rows.length, 0)

  const test1 = setup({ demo: true }, { ...order, metadata: { baselinker_skip: true } })
  await orderPlaced({ event: { data: { id: order.id } }, container: test1.container } as never)
  assert.equal(test1.orders.rows[0].status, "skipped")
  assert.equal(test1.orders.rows[0].last_error_code, "skip_key")
})
