/**
 * Test doubles shared by the flow tests (not a test itself: the runner picks
 * up `*.test.ts` only).
 *
 *   memoryStores  the thread, settings and draft order stores with the SAME
 *                 rules as the SQL ones: moves only from the given statuses
 *                 and the current mode, guards on the offer and the price,
 *                 one draft row per thread, claims only from pending or
 *                 failed, finish only for the claim's owner
 *   setup         a fake Medusa container (module service, Query, event bus,
 *                 the stores, a draft creator) around one set of options
 */
import { resolveOptions, type NegotiationsPluginOptions } from "../src/modules/negotiations/lib/options.ts"
import { ACTIVE_STATUSES, DEMO_ID_PREFIX, REF_START } from "../src/modules/negotiations/lib/constants.ts"
import { THREAD_PATCHABLE, DRAFT_PATCHABLE, type DraftOrderStore, type SettingStore, type ThreadFilter, type ThreadStore } from "../src/modules/negotiations/lib/store.ts"
import type { DraftOrderRow, MessageInsert, MessageRow, RunRow, SettingRow, ThreadInsert, ThreadRow } from "../src/modules/negotiations/lib/rows.ts"
import { forgetStoreDefaults, STORES_KEY } from "../src/workflows/negotiations/runtime.ts"
import { DRAFT_CREATOR_KEY, type DraftCreator } from "../src/workflows/negotiations/draft-orders.ts"

export type Row = Record<string, any>

const copy = <T>(v: T): T => (v === null || v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

function rowCopy<T extends Row>(r: T): T {
  const out: Row = {}
  for (const [k, v] of Object.entries(r)) out[k] = v instanceof Date ? new Date(v.getTime()) : v && typeof v === "object" ? copy(v) : v
  return out as T
}

export interface Memory {
  threads: Map<string, ThreadRow>
  messages: MessageRow[]
  settings: Map<string, SettingRow>
  runs: RunRow[]
  drafts: Map<string, DraftOrderRow>
  stores: { threads: ThreadStore; settings: SettingStore; drafts: DraftOrderStore }
}

const time = (v: unknown) => (v instanceof Date ? v.getTime() : new Date(String(v)).getTime())

export function memoryStores(): Memory {
  const threads = new Map<string, ThreadRow>()
  const messages: MessageRow[] = []
  const settings = new Map<string, SettingRow>()
  const runs: RunRow[] = []
  const drafts = new Map<string, DraftOrderRow>()
  let seq = REF_START - 1

  const insertMessage = (m: MessageInsert): MessageRow => {
    const row: MessageRow = { ...m, updated_at: m.created_at, deleted_at: null }
    messages.push(row)
    return rowCopy(row)
  }

  const matches = (r: ThreadRow, f: ThreadFilter): boolean => {
    if (r.deleted_at) return false
    if (Boolean(r.demo) !== f.demo) return false
    if (f.statuses && f.statuses.length > 0 && !f.statuses.includes(r.status as never)) return false
    if (f.waitingForTeam && !(r.waiting_for === "team" && (ACTIVE_STATUSES as readonly string[]).includes(r.status))) return false
    if (f.customerId && r.customer_id !== f.customerId) return false
    if (f.product && !(r.product_id === f.product.id || (!r.product_id && r.sku && f.product.skus.includes(r.sku)))) return false
    if (f.excludeDemoStory && r.id.startsWith(DEMO_ID_PREFIX)) return false
    if (f.search) {
      const needle = f.search.like.replace(/^%|%$/g, "").replace(/\\(.)/g, "$1").toLowerCase()
      const hay = [r.ref, r.sku, r.title].map((x) => String(x ?? "").toLowerCase())
      const hit = hay.some((h) => h.includes(needle)) || f.search.customerIds.includes(r.customer_id ?? "") || f.search.productIds.includes(r.product_id ?? "")
      if (!hit) return false
    }
    return true
  }

  const sorted = (rows: ThreadRow[]) =>
    rows.sort((a, b) => time(b.last_activity_at ?? b.updated_at) - time(a.last_activity_at ?? a.updated_at) || (a.id < b.id ? 1 : -1))

  const threadStore: ThreadStore = {
    async nextRefNumber() {
      seq += 1
      return seq
    },
    async insertThread(thread: ThreadInsert, message: MessageInsert) {
      const row = { ...thread, deleted_at: null } as unknown as ThreadRow
      threads.set(thread.id, row)
      return { thread: rowCopy(row), message: insertMessage(message) }
    },
    async act(args) {
      const r = threads.get(args.id)
      if (!r || r.deleted_at || Boolean(r.demo) !== args.demo || !args.from.includes(r.status as never)) return null
      if (args.guard?.offeredAmount !== undefined && r.offered_amount !== args.guard.offeredAmount) return null
      if (args.guard?.priceAmount !== undefined && r.price_amount !== args.guard.priceAmount) return null
      if (args.guard?.maxMessages !== undefined && (r.message_count ?? 0) >= args.guard.maxMessages) return null
      for (const column of THREAD_PATCHABLE) {
        const v = (args.patch as Row)[column]
        if (v !== undefined) (r as Row)[column] = v
      }
      if (args.countMessage) r.message_count = (r.message_count ?? 0) + 1
      r.updated_at = args.now
      const message = args.message ? insertMessage(args.message) : null
      return { thread: rowCopy(r), message }
    },
    async materialize(id, v) {
      const r = threads.get(id)
      if (!r || r.requested_amount != null || r.offered_amount != null || r.agreed_amount != null || r.price_amount != null) return
      r.currency_code = r.currency_code ?? v.currency_code
      r.requested_amount = v.requested_amount
      r.offered_amount = v.offered_amount
      r.agreed_amount = v.agreed_amount
      r.price_amount = v.price_amount
    },
    async getThread(id) {
      const r = threads.get(id)
      return r && !r.deleted_at ? rowCopy(r) : null
    },
    async listMessages(threadId, includeInternal) {
      return messages
        .filter((m) => m.negotiation_id === threadId && !m.deleted_at && (includeInternal || m.internal !== true))
        .sort((a, b) => time(a.created_at) - time(b.created_at) || (a.id < b.id ? -1 : 1))
        .map(rowCopy)
    },
    async lastMessages(ids) {
      const out: MessageRow[] = []
      for (const id of ids) {
        const list = messages.filter((m) => m.negotiation_id === id && m.internal !== true).sort((a, b) => time(b.created_at) - time(a.created_at))
        if (list[0]) out.push(rowCopy(list[0]))
      }
      return out
    },
    async listThreads(f) {
      const all = sorted([...threads.values()].filter((r) => matches(r, f)))
      if (f.oldestFirst) all.reverse()
      return { rows: all.slice(f.offset, f.offset + f.limit).map(rowCopy), count: all.length }
    },
    async statusCounts(demo) {
      const by = new Map<string, { status: string; count: number; waiting: number; from_store: number }>()
      for (const r of threads.values()) {
        if (r.deleted_at || Boolean(r.demo) !== demo) continue
        const c = by.get(r.status) ?? { status: r.status, count: 0, waiting: 0, from_store: 0 }
        c.count += 1
        if (r.waiting_for === "team") c.waiting += 1
        if ((r.source ?? "store") === "store") c.from_store += 1
        by.set(r.status, c)
      }
      return [...by.values()]
    },
    async activeThreads(demo, limit) {
      return sorted([...threads.values()].filter((r) => !r.deleted_at && Boolean(r.demo) === demo && (ACTIVE_STATUSES as readonly string[]).includes(r.status)))
        .slice(0, limit)
        .map(rowCopy)
    },
    async acceptedSince(demo, since) {
      return [...threads.values()]
        .filter((r) => !r.deleted_at && Boolean(r.demo) === demo && r.status === "accepted" && time(r.closed_at ?? r.updated_at) >= since.getTime())
        .map(rowCopy)
    },
    async activeForCustomer(customerId, demo) {
      return [...threads.values()]
        .filter((r) => !r.deleted_at && r.customer_id === customerId && Boolean(r.demo) === demo && (ACTIVE_STATUSES as readonly string[]).includes(r.status))
        .map(rowCopy)
    },
    async expireDue(args) {
      const due = [...threads.values()]
        .filter((r) => {
          if (r.deleted_at || Boolean(r.demo) !== args.demo || !(ACTIVE_STATUSES as readonly string[]).includes(r.status)) return false
          if (r.expires_at) return time(r.expires_at) <= args.now.getTime()
          return args.cutoff !== null && time(r.last_activity_at ?? r.updated_at) <= args.cutoff.getTime()
        })
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, args.limit)
      return due.map((r) => {
        const previousStatus = r.status
        Object.assign(r, { status: "expired", waiting_for: null, closed_at: args.now, closed_by: "system", message_count: (r.message_count ?? 0) + 1, updated_at: args.now })
        return { thread: rowCopy(r), previousStatus, message: insertMessage(args.message(rowCopy(r))) }
      })
    },
    async replaceDemoStory(newThreads, newMessages) {
      for (const id of [...threads.keys()]) if (id.startsWith(DEMO_ID_PREFIX)) threads.delete(id)
      for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].negotiation_id.startsWith(DEMO_ID_PREFIX)) messages.splice(i, 1)
      for (const [id, d] of [...drafts.entries()]) if (d.negotiation_id.startsWith(DEMO_ID_PREFIX)) drafts.delete(id)
      for (const t of newThreads) if (!threads.has(t.id)) threads.set(t.id, { ...(t as unknown as ThreadRow), deleted_at: null })
      for (const m of newMessages) if (!messages.some((x) => x.id === m.id)) messages.push({ ...m, updated_at: m.created_at, deleted_at: null })
    },
    async countDemoStory() {
      return [...threads.keys()].filter((id) => id.startsWith(DEMO_ID_PREFIX)).length
    },
  }

  const settingStore: SettingStore = {
    async get(keys) {
      return keys.map((k) => settings.get(k)).filter((r): r is SettingRow => Boolean(r)).map(rowCopy)
    },
    async put(key, value, updatedBy, now) {
      const row: SettingRow = { id: settings.get(key)?.id ?? `negset_${settings.size + 1}`, key, value: copy(value), updated_by: updatedBy, updated_at: now }
      settings.set(key, row)
      return rowCopy(row)
    },
    async recordRun(run, keep) {
      const row: RunRow = { ...run, counts: copy(run.counts) }
      runs.unshift(row)
      const same = runs.filter((r) => r.kind === run.kind && r.demo === run.demo)
      for (const old of same.slice(keep)) runs.splice(runs.indexOf(old), 1)
      return rowCopy(row)
    },
    async runs(demo, limit) {
      return runs.filter((r) => r.demo === demo).slice(0, limit).map(rowCopy)
    },
    async lastRuns(demo) {
      const seen = new Set<string>()
      return runs.filter((r) => r.demo === demo && !seen.has(r.kind) && (seen.add(r.kind), true)).map(rowCopy)
    },
  }

  const draftStore: DraftOrderStore = {
    async queue(r) {
      for (const d of drafts.values()) if (d.negotiation_id === r.negotiation_id && d.demo === r.demo) return null
      const row: DraftOrderRow = {
        id: r.id,
        negotiation_id: r.negotiation_id,
        demo: r.demo,
        state: "pending",
        draft_order_id: null,
        display_id: null,
        error: null,
        attempts: 0,
        claim_token: null,
        claimed_at: null,
        lease_until: null,
        payload: null,
        requested_by: r.requested_by,
        created_at: r.now,
        updated_at: r.now,
      }
      drafts.set(row.id, row)
      return rowCopy(row)
    },
    async list(demo, states, limit) {
      return [...drafts.values()]
        .filter((d) => d.demo === demo && (!states || states.length === 0 || states.includes(d.state)))
        .sort((a, b) => time(a.created_at) - time(b.created_at))
        .slice(0, limit)
        .map(rowCopy)
    },
    async byThreads(ids, demo) {
      return [...drafts.values()].filter((d) => d.demo === demo && ids.includes(d.negotiation_id)).map(rowCopy)
    },
    async claim(id, args) {
      const d = drafts.get(id)
      if (!d || !["pending", "failed"].includes(d.state)) return null
      Object.assign(d, { state: "creating", claim_token: args.token, claimed_at: args.now, lease_until: args.leaseUntil, attempts: d.attempts + 1, updated_at: args.now })
      return rowCopy(d)
    },
    async finish(id, token, patch, now) {
      const d = drafts.get(id)
      if (!d || d.state !== "creating" || d.claim_token !== token) return false
      for (const column of DRAFT_PATCHABLE) {
        const v = (patch as Row)[column]
        if (v !== undefined) (d as Row)[column] = v
      }
      Object.assign(d, { claim_token: null, lease_until: null, updated_at: now })
      return true
    },
    async transition(id, from, patch, now) {
      const d = drafts.get(id)
      if (!d || !from.includes(d.state)) return null
      for (const column of DRAFT_PATCHABLE) {
        const v = (patch as Row)[column]
        if (v !== undefined) (d as Row)[column] = v
      }
      d.updated_at = now
      return rowCopy(d)
    },
    async expireLeases(now, demo) {
      const out: DraftOrderRow[] = []
      for (const d of drafts.values()) {
        if (d.state === "creating" && d.demo === demo && d.lease_until && time(d.lease_until) < now.getTime()) {
          Object.assign(d, { state: "unknown", claim_token: null, lease_until: null, updated_at: now })
          out.push(rowCopy(d))
        }
      }
      return out
    },
    async counts(demo) {
      const out: Record<string, number> = {}
      for (const d of drafts.values()) if (d.demo === demo) out[d.state] = (out[d.state] ?? 0) + 1
      return out
    },
  }

  return { threads, messages, settings, runs, drafts, stores: { threads: threadStore, settings: settingStore, drafts: draftStore } }
}

/* ------------------------------------------------------------------ */
/* Catalog for the fake Query                                          */
/* ------------------------------------------------------------------ */

export interface Catalog {
  products: Row[]
  variants: Row[]
  customers: Row[]
  carts: Row[]
  regions: Row[]
  store: Row | null
  orders: Row[]
}

export function catalog(over: Partial<Catalog> = {}): Catalog {
  const product = (id: string, title: string, status = "published", channels = ["sc_main"]) => ({ id, title, status, thumbnail: null, sales_channels: channels.map((c) => ({ id: c })) })
  const products = over.products ?? [
    product("prod_drill", "Cordless drill 18V"),
    product("prod_screws", "Wood screws 4x40"),
    product("prod_gloves", "Coated gloves"),
    product("prod_draft", "Unreleased saw", "draft"),
    product("prod_multi", "Helmet"),
  ]
  const price = (amount: number | string, currency = "pln", extra: Row = {}) => ({ amount, currency_code: currency, min_quantity: null, max_quantity: null, price_list_id: null, rules_count: 0, ...extra })
  const variants = over.variants ?? [
    { id: "variant_drill", sku: "KS-DRILL-18V", title: "Default variant", product_id: "prod_drill", prices: [price(549), price(489, "pln", { min_quantity: 20 }), price(120, "eur"), price(399, "pln", { price_list_id: "plist_vip" })] },
    { id: "variant_screws", sku: "KS-SCREW-440", title: "Box of 200", product_id: "prod_screws", prices: [price("42.90")] },
    { id: "variant_gloves", sku: "KS-GLOVES", title: "Size 10", product_id: "prod_gloves", prices: [price(8.5)] },
    { id: "variant_saw", sku: "KS-SAW", title: "Default", product_id: "prod_draft", prices: [price(300)] },
    { id: "variant_helmet_s", sku: "KS-HELMET-S", title: "S", product_id: "prod_multi", prices: [price(45)] },
    { id: "variant_helmet_l", sku: "KS-HELMET-L", title: "L", product_id: "prod_multi", prices: [price(45)] },
  ]
  return {
    products,
    variants,
    customers: over.customers ?? [
      { id: "cus_anna", email: "anna@example.com", first_name: "Anna", last_name: "Nowak", company_name: "Elektro Test", has_account: true, addresses: [{ country_code: "pl", city: "Poznań", address_1: "Testowa 1", is_default_shipping: true, is_default_billing: true }] },
      { id: "cus_ben", email: "ben@example.com", first_name: "Ben", last_name: "Stone", company_name: null, has_account: true, addresses: [] },
    ],
    carts: over.carts ?? [
      {
        id: "cart_anna",
        customer_id: "cus_anna",
        currency_code: "pln",
        completed_at: null,
        items: [
          { variant_id: "variant_drill", product_id: "prod_drill", variant_sku: "KS-DRILL-18V", title: "Cordless drill 18V", product_title: "Cordless drill 18V", variant_title: "Default variant", quantity: 2, unit_price: 549 },
          { variant_id: "variant_screws", product_id: "prod_screws", variant_sku: "KS-SCREW-440", title: "Wood screws", product_title: "Wood screws 4x40", variant_title: "Box of 200", quantity: 10, unit_price: 42.9 },
        ],
      },
      { id: "cart_ben", customer_id: "cus_ben", currency_code: "eur", completed_at: null, items: [{ variant_id: "variant_drill", quantity: 1, unit_price: 120 }] },
    ],
    regions: over.regions ?? [
      { id: "reg_pl", name: "Polska", currency_code: "pln" },
      { id: "reg_eu", name: "Europe", currency_code: "eur" },
    ],
    store: over.store === undefined ? { id: "store_1", default_sales_channel_id: "sc_main", supported_currencies: [{ currency_code: "pln", is_default: true }, { currency_code: "eur", is_default: false }] } : over.store,
    orders: over.orders ?? [],
  }
}

function pick(record: Row, fields: string[]): Row {
  /* The fake Query returns whole records; the code reads only what it asked for. */
  void fields
  return copy(record)
}

function idFilter(filters: Row | undefined): string[] | null {
  const id = filters?.id
  if (id === undefined) return null
  return Array.isArray(id) ? id : [id]
}

export function fakeQuery(c: Catalog) {
  return {
    async graph(args: Row) {
      const ids = idFilter(args.filters)
      const by = <T extends Row>(rows: T[]) => (ids ? rows.filter((r) => ids.includes(r.id)) : rows)
      switch (args.entity) {
        case "product_variant": {
          let rows = by(c.variants).map((v) => ({ ...v, product: c.products.find((p) => p.id === v.product_id) ?? null }))
          if (args.filters?.product_id) rows = rows.filter((v) => v.product_id === args.filters.product_id)
          return { data: rows.map((r) => pick(r, args.fields)) }
        }
        case "product": {
          const q = args.filters?.q ? String(args.filters.q).toLowerCase() : null
          const rows = by(c.products).filter((p) => !q || String(p.title ?? "").toLowerCase().includes(q))
          return { data: rows.map((p) => ({ ...p, variants: c.variants.filter((v) => v.product_id === p.id) })) }
        }
        case "customer": {
          if (args.filters?.q) {
            const q = String(args.filters.q).toLowerCase()
            return { data: c.customers.filter((x) => [x.email, x.company_name, x.first_name, x.last_name].some((v) => String(v ?? "").toLowerCase().includes(q))) }
          }
          return { data: by(c.customers).map(copy) }
        }
        case "cart":
          return { data: by(c.carts).map(copy) }
        case "region":
          return { data: c.regions.map(copy) }
        case "store":
          return { data: c.store ? [copy(c.store)] : [] }
        case "order":
          return { data: c.orders.map(copy) }
        default:
          return { data: [] }
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* The container                                                       */
/* ------------------------------------------------------------------ */

export interface Emitted {
  name: string
  data: Row
}

export interface Setup {
  container: { resolve<T = unknown>(key: string, options?: { allowUnregistered?: boolean }): T }
  memory: Memory
  events: Emitted[]
  catalog: Catalog
  created: Row[]
  options: ReturnType<typeof resolveOptions>
  /** What the fake Medusa does on the next create: "ok" or an error message. */
  nextCreate: { fail: string | null }
}

export function setup(options: NegotiationsPluginOptions = {}, over: Partial<Catalog> = {}): Setup {
  forgetStoreDefaults()
  const resolved = resolveOptions(options)
  const memory = memoryStores()
  const events: Emitted[] = []
  const cat = catalog(over)
  const created: Row[] = []
  const nextCreate = { fail: null as string | null }
  const logs: string[] = []
  const service = {
    getOptions: () => resolved,
    isDemo: () => resolved.demo,
    getLogger: () => ({ info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) }),
  }
  const creator: DraftCreator = {
    async create(input) {
      if (nextCreate.fail) {
        const message = nextCreate.fail
        nextCreate.fail = null
        throw new Error(message)
      }
      const order = { id: `order_${created.length + 1}`, display_id: 100 + created.length + 1, metadata: input.metadata, is_draft_order: true, created_at: new Date() }
      created.push({ ...order, input })
      cat.orders.push(order)
      return { id: order.id, displayId: order.display_id }
    },
    async find(threadId) {
      const hit = cat.orders.find((o) => o.metadata?.negotiation_id === threadId)
      return hit ? { id: hit.id, displayId: hit.display_id } : null
    },
  }
  const registry: Record<string, unknown> = {
    negotiations: service,
    [STORES_KEY]: memory.stores,
    query: fakeQuery(cat),
    event_bus: {
      async emit(message: { name: string; data: Row } | Array<{ name: string; data: Row }>) {
        for (const m of Array.isArray(message) ? message : [message]) events.push({ name: m.name, data: copy(m.data) })
      },
    },
    [DRAFT_CREATOR_KEY]: creator,
  }
  const container = {
    resolve<T>(key: string, opts?: { allowUnregistered?: boolean }): T {
      if (key in registry) return registry[key] as T
      if (opts?.allowUnregistered) return undefined as T
      throw new Error(`Could not resolve '${key}'`)
    },
  }
  return { container, memory, events, catalog: cat, created, options: resolved, nextCreate }
}

/** Shifts every stored time of a thread (and its messages) into the past, as if it were older. */
export function age(s: Setup, threadId: string, ms: number): void {
  const t = s.memory.threads.get(threadId)
  if (!t) return
  for (const k of ["created_at", "updated_at", "last_activity_at", "expires_at", "closed_at"] as const) {
    const v = (t as Row)[k]
    if (v) (t as Row)[k] = new Date(time(v) - ms)
  }
  for (const m of s.memory.messages) if (m.negotiation_id === threadId) m.created_at = new Date(time(m.created_at) - ms)
}
