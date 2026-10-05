/**
 * The order outbox end to end: the real `sendOrderNow` (rows, lock, payload,
 * marker scan, client, retries, metadata, events) against an in-memory
 * service, a fake Medusa container and a scripted connector.php. No network:
 * `fetch` is replaced for the duration of each test and refuses any other URL.
 */
import { afterEach, test } from "node:test"
import assert from "node:assert/strict"
import { resolveOptions, type BaseLinkerPluginOptions } from "../src/modules/baselinker/lib/options.ts"
import { maskSecrets } from "../src/modules/baselinker/lib/security.ts"
import { sendOrderNow } from "../src/workflows/baselinker/orders.ts"

type Row = Record<string, any>

function matches(row: Row, filter: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    const v = row[key]
    if (Array.isArray(cond)) {
      if (!cond.includes(v)) return false
    } else if (cond === null) {
      if (v !== null && v !== undefined) return false
    } else if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ("$ne" in c && (c.$ne === null ? v === null || v === undefined : v === c.$ne)) return false
      if ("$lte" in c && !(v && new Date(v).getTime() <= new Date(c.$lte as Date).getTime())) return false
      if ("$gte" in c && !(v && new Date(v).getTime() >= new Date(c.$gte as Date).getTime())) return false
    } else if (v !== cond) return false
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
      if (this.prefix === "blord" && this.rows.some((r) => r.order_id === row.order_id && r.demo === row.demo)) throw new Error("unique violation")
      this.rows.push(row)
      return { ...row }
    }
    return Array.isArray(data) ? data.map(one) : one(data)
  }
  update(data: Row | Row[]): Row | Row[] {
    const one = (d: Row) => {
      const row = this.rows.find((r) => r.id === d.id)
      if (!row) throw new Error(`no row ${d.id}`)
      Object.assign(row, d, { updated_at: new Date() })
      return { ...row }
    }
    return Array.isArray(data) ? data.map(one) : one(data)
  }
  delete(ids: string[]): void {
    this.rows = this.rows.filter((r) => !ids.includes(r.id))
  }
}

const TOKEN = "5012345-5067890-QWERTYUIOPASDFGHJKLZXCVBNM1234567890ABCDEFGHIJKLMNOP"

function setup(options: BaseLinkerPluginOptions, order: Row, extra: Record<string, unknown> = {}) {
  const o = resolveOptions(options)
  const orders = new Table("blord")
  const products = new Table("blprod")
  const runs = new Table("blrun")
  const svc = {
    getOptions: () => o,
    getLogger: () => ({ info: () => undefined, warn: () => undefined, error: () => undefined }),
    isDemo: () => o.demo,
    isConfigured: () => true,
    missingOptions: () => [],
    mask: (s: string) => maskSecrets(s, [o.apiToken]),
    listBaseLinkerOrders: async (f: Row, c: Row) => orders.list(f, c),
    createBaseLinkerOrders: async (d: Row) => orders.create(d),
    updateBaseLinkerOrders: async (d: Row) => orders.update(d),
    listBaseLinkerProducts: async (f: Row, c: Row) => products.list(f, c),
    createBaseLinkerSyncRuns: async (d: Row) => runs.create(d),
    listBaseLinkerSyncRuns: async (f: Row, c: Row) => runs.list(f, c),
    deleteBaseLinkerSyncRuns: async (ids: string[]) => runs.delete(ids),
  }
  const events: Array<{ name: string; data: Row }> = []
  const metadata: Row = { ...(order.metadata ?? {}) }
  const registry: Record<string, unknown> = {
    baselinker: svc,
    query: {
      graph: async ({ entity, filters }: Row) => ({
        data: entity === "order" && filters?.id === order.id ? [{ ...order, metadata: { ...metadata } }] : [],
      }),
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
  return { container, orders, products, events, metadata }
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

test("demo: the order gets a simulated BaseLinker id, the metadata and the event", async () => {
  const s = setup({ demo: true }, order)
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "sent")
  assert.equal(out.blOrderId, "9100001")
  assert.equal(s.orders.rows[0].status, "sent")
  assert.equal(s.metadata.baselinker_order_id, "9100001")
  assert.equal(s.events[0].name, "baselinker.order_sent")
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

test("a second sender of the same order is turned away while the first holds the lock", async () => {
  const s = setup({ demo: true }, order, {
    locking: {
      acquire: async () => {
        throw new Error('Failed to acquire lock for key "baselinker:order"')
      },
      release: async () => true,
    },
  })
  const out = await sendOrderNow(s.container, order.id)
  assert.equal(out.status, "busy")
  assert.equal(s.orders.rows.length, 0)
})
