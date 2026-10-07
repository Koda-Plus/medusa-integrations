/**
 * A small store for the route and contract tests: four variants, their
 * inventory, three orders, the plugin service of fakes.ts and a recorder of
 * every call that would change data (plugin tables, Medusa orders, events,
 * the network). Not a test file itself (the runner picks `*.test.ts`).
 */
import type { BaseLinkerPluginOptions } from "../src/modules/baselinker/lib/options.ts"
import { fakeContainer, fakeQuery, fakeService, type Row } from "./fakes.ts"

export const VARIANTS = [
  { id: "var_a", title: "Default variant", sku: "OP-A", ean: null, product_id: "prod_a", manage_inventory: true, product: { title: "Opona A" }, inventory_items: [{ inventory_item_id: "iitem_a", required_quantity: 1 }] },
  { id: "var_b", title: "16 cali", sku: "OP-B", ean: "5901234123457", product_id: "prod_b", manage_inventory: true, product: { title: "Opona B" }, inventory_items: [{ inventory_item_id: "iitem_b", required_quantity: 1 }] },
  { id: "var_c", title: "Default variant", sku: "OP-C", ean: null, product_id: "prod_c", manage_inventory: true, product: { title: "Opona C" }, inventory_items: [{ inventory_item_id: "iitem_c", required_quantity: 1 }] },
  { id: "var_d", title: "Default variant", sku: "OP-D", ean: null, product_id: "prod_d", manage_inventory: true, product: { title: "Opona D" }, inventory_items: [{ inventory_item_id: "iitem_d", required_quantity: 1 }] },
]

const LEVELS = [
  { id: "ilev_a", inventory_item_id: "iitem_a", location_id: "sloc_1", stocked_quantity: 4, reserved_quantity: 1 },
  { id: "ilev_b", inventory_item_id: "iitem_b", location_id: "sloc_1", stocked_quantity: 2, reserved_quantity: 0 },
  { id: "ilev_c", inventory_item_id: "iitem_c", location_id: "sloc_1", stocked_quantity: 7, reserved_quantity: 0 },
]

const PRODUCTS = VARIANTS.map((v) => ({
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

export function storeOrder(id: string, displayId: number, over: Row = {}): Row {
  return {
    id,
    display_id: displayId,
    email: "anna@example.com",
    currency_code: "pln",
    created_at: new Date(Date.now() - displayId * 60_000).toISOString(),
    status: "pending",
    metadata: {},
    total: 120,
    shipping_total: 20,
    items: [{ id: `ordli_${displayId}`, title: "Opona A", variant_id: "var_a", variant_sku: "OP-A", detail: { quantity: 1 }, total: 100, tax_lines: [{ rate: 23 }] }],
    shipping_methods: [{ name: "Kurier", amount: 20 }],
    payment_collections: [],
    ...over,
  }
}

export function storeFixture(options: BaseLinkerPluginOptions, orders: Row[] = []) {
  const f = fakeService(options)
  const writes: string[] = []
  const metadataWrites: string[] = []
  const events: Array<{ name: string; data: Row }> = []
  const network: string[] = []
  let recording = false

  /* The plugin service, with every create, update and delete recorded while `recording` is on. */
  const svc = new Proxy(f.svc, {
    get(target, prop: string) {
      const value = target[prop]
      if (typeof value === "function" && /^(create|update|delete|softDelete|restore)/.test(prop)) {
        return (...args: unknown[]) => {
          if (recording) writes.push(prop)
          return value(...args)
        }
      }
      return value
    },
  })
  const byId = (filters: Row | undefined) => {
    const ids = filters?.id === undefined ? null : Array.isArray(filters.id) ? filters.id : [filters.id]
    return orders.filter((o) => !ids || ids.includes(o.id))
  }
  const registry: Record<string, unknown> = {
    baselinker: svc,
    query: fakeQuery({
      order: ({ filters, pagination }: Row) => {
        const found = byId(filters).map((o) => ({ ...o, metadata: { ...(o.metadata ?? {}) } }))
        return pagination?.take ? found.slice(0, pagination.take) : found
      },
      product_variant: ({ pagination, filters }: Row) => {
        if (filters?.product_id) return VARIANTS.filter((v) => [filters.product_id].flat().includes(v.product_id))
        if (filters?.id) return VARIANTS.filter((v) => [filters.id].flat().includes(v.id)).map((v) => ({ ...v, prices: [{ amount: 300, currency_code: "pln" }] }))
        const skip = pagination?.skip ?? 0
        return VARIANTS.slice(skip, skip + (pagination?.take ?? 500))
      },
      product: ({ pagination, filters }: Row) => {
        if (filters?.id) return PRODUCTS.filter((p) => [filters.id].flat().includes(p.id))
        return PRODUCTS.slice(pagination?.skip ?? 0, (pagination?.skip ?? 0) + (pagination?.take ?? 100))
      },
      inventory_item: ({ filters }: Row) =>
        VARIANTS.filter((v) => [filters?.id].flat().includes(v.inventory_items[0].inventory_item_id)).map((v) => ({
          id: v.inventory_items[0].inventory_item_id,
          sku: v.sku,
          variants: [{ id: v.id, product_id: v.product_id }],
        })),
      product_category: () => [],
      store: () => [{ id: "store_1", default_sales_channel_id: "sc_1" }],
    }),
    stock_location: { listStockLocations: async () => [{ id: "sloc_1" }] },
    inventory: { listInventoryLevels: async () => LEVELS },
    pricing: { listPricePreferences: async () => [{ is_tax_inclusive: true }] },
    order: {
      retrieveOrder: async (id: string) => ({ id, metadata: { ...(orders.find((o) => o.id === id)?.metadata ?? {}) } }),
      updateOrders: async (id: string, data: Row) => {
        metadataWrites.push(id)
        const o = orders.find((x) => x.id === id)
        if (o) o.metadata = data.metadata
      },
    },
    event_bus: { emit: async (e: { name: string; data: Row }) => void events.push(e) },
  }
  const realFetch = globalThis.fetch
  return {
    container: fakeContainer(registry),
    s: f,
    orders,
    writes,
    metadataWrites,
    events,
    network,
    /** From now on every write, event and network call is recorded; fetch fails the test. */
    record() {
      recording = true
      writes.length = 0
      metadataWrites.length = 0
      events.length = 0
      globalThis.fetch = (async (url: string | URL) => {
        network.push(String(url))
        throw new Error(`no network in this test: ${String(url)}`)
      }) as typeof fetch
    },
    restore() {
      recording = false
      globalThis.fetch = realFetch
    },
  }
}

/** A request and a response for a route handler. */
export function call(container: unknown, input: { query?: Row; params?: Row; body?: unknown; method?: string } = {}) {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headersSent: false,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.body = body
      res.headersSent = true
      return res
    },
    setHeader(k: string, v: string) {
      res.headers[k.toLowerCase()] = v
    },
    end() {
      res.headersSent = true
    },
  }
  const req = { scope: container, query: input.query ?? {}, params: input.params ?? {}, body: input.body, method: input.method ?? "GET", path: "/admin/baselinker", headers: {} }
  return { req: req as never, res: res as never, out: res }
}
