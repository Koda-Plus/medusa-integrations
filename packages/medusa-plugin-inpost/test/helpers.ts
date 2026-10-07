/**
 * Test doubles shared by the flow tests (this file is not a test itself: the
 * runner picks up `*.test.ts` only).
 *
 *   Table        rows filtered like the generated service filters them
 *   memoryStore  the atomic store with the SAME rules as the SQL one: one row
 *                per (fulfillment, demo), claim only from pending, finish only
 *                for the claim's owner, transitions only from given states,
 *                compare and set of the status, unique dedupe keys
 *   setup        a fake Medusa container (the module service, Query, the event
 *                bus, the store, a ShipX client over a fake fetch)
 *   FakeShipx    a scripted ShipX organization behind `fetch`: it keeps
 *                shipments, answers the documented endpoints, can lose answers
 *                on purpose and records every call
 */
import { createShipxClient } from "../src/modules/inpost/lib/client.ts"
import { resolveOptions, type InpostPluginOptions } from "../src/modules/inpost/lib/options.ts"
import { maskSecrets } from "../src/modules/inpost/lib/security.ts"
import { PATCHABLE_COLUMNS, type NewEvent, type NewParcel, type ParcelPatch, type ParcelStore, type StatusUpdate } from "../src/modules/inpost/lib/store.ts"

export type Row = Record<string, any>

/** A made-up ShipX token: a JWT-like string that must never appear in a message. */
export const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJ0ZXN0IjoidGVzdC10b2tlbi1rb2RhLXN1cHBseS0wMDAwMDAwMDAwMDAwMDAwIn0.c2lnbmF0dXJlLW9mLXRoZS10ZXN0LXRva2VuLXRoYXQtaXMtbG9uZw"
export const ORG = "12345"
export const SECRET = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
export const LIVE: InpostPluginOptions = { apiToken: TOKEN, organizationId: ORG, shipmentWriter: true, fulfillmentStatusWriter: true, requestsPerMinute: 6000, webhookSecret: SECRET }

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function time(v: unknown): number {
  return v instanceof Date ? v.getTime() : new Date(v as string).getTime()
}

export function matches(row: Row, filter: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$or") {
      if (!(cond as Array<Record<string, unknown>>).some((f) => matches(row, f))) return false
      continue
    }
    if (key === "$and") {
      if (!(cond as Array<Record<string, unknown>>).every((f) => matches(row, f))) return false
      continue
    }
    const v = row[key]
    if (Array.isArray(cond)) {
      if (!cond.includes(v)) return false
    } else if (cond === null) {
      if (v !== null && v !== undefined) return false
    } else if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ("$nin" in c && (v === null || v === undefined || (c.$nin as unknown[]).includes(v))) return false
      if ("$ne" in c && v === c.$ne) return false
      if ("$lte" in c && !(v !== null && v !== undefined && time(v) <= time(c.$lte))) return false
      if ("$gte" in c && !(v !== null && v !== undefined && time(v) >= time(c.$gte))) return false
      if ("$ilike" in c) {
        const needle = String(c.$ilike).replace(/^%|%$/g, "").replace(/\\(.)/g, "$1").toLowerCase()
        if (!String(v ?? "").toLowerCase().includes(needle)) return false
      }
    } else if (v !== cond) return false
  }
  return true
}

export class Table {
  rows: Row[] = []
  private seq = 0
  private readonly prefixName: string
  constructor(prefixName: string) {
    this.prefixName = prefixName
  }

  nextId(): string {
    this.seq += 1
    return `${this.prefixName}_${String(this.seq).padStart(4, "0")}`
  }

  list(filter: Record<string, unknown> = {}, config: { skip?: number; take?: number | null; order?: Record<string, string> } = {}): Row[] {
    let found = this.rows.filter((r) => !r.deleted_at && matches(r, filter))
    if (config.order) {
      const keys = Object.entries(config.order)
      found = [...found].sort((a, b) => {
        for (const [k, dir] of keys) {
          const x = a[k] instanceof Date ? a[k].getTime() : a[k]
          const y = b[k] instanceof Date ? b[k].getTime() : b[k]
          if (x === y) continue
          if (x === null || x === undefined) return 1
          if (y === null || y === undefined) return -1
          return (x < y ? -1 : 1) * (String(dir).toUpperCase() === "DESC" ? -1 : 1)
        }
        return 0
      })
    }
    const skip = config.skip ?? 0
    const take = config.take === null || config.take === undefined ? found.length : config.take
    return found.slice(skip, skip + take).map((r) => ({ ...r }))
  }

  insert(data: Row): Row {
    const now = new Date()
    const row = { id: this.nextId(), created_at: now, updated_at: now, deleted_at: null, ...data }
    this.rows.push(row)
    return { ...row }
  }
}

const PARCEL_DEFAULTS: Row = {
  display_id: null,
  fulfillment_id: null,
  locker_code: null,
  locker_name: null,
  locker_address: null,
  parcel_size: null,
  parcel_no: 1,
  cod_minor: null,
  currency: null,
  reference: null,
  state: "pending",
  status: null,
  status_at: null,
  shipment_id: null,
  tracking_number: null,
  sending_method: null,
  plan_hash: null,
  problems: null,
  skip_reason: null,
  external: false,
  error: null,
  error_code: null,
  attempts: 0,
  claim_token: null,
  claimed_at: null,
  lease_until: null,
  created_by: null,
  shipment_created_at: null,
  offer: null,
  buy_requested_at: null,
  dispatch_state: null,
  dispatch_order_id: null,
  dispatch_error: null,
  dispatch_at: null,
  fulfillment_canceled_at: null,
  shipped_marked_at: null,
  delivered_marked_at: null,
  status_writer_error: null,
  last_checked_at: null,
}

function apply(row: Row, patch: ParcelPatch): void {
  for (const column of PATCHABLE_COLUMNS) {
    const v = (patch as Row)[column]
    if (v !== undefined) row[column] = v
  }
  row.updated_at = new Date()
}

export function memoryStore(parcels: Table, events: Table, settings: Table): ParcelStore {
  const live = (id: string) => parcels.rows.find((r) => r.id === id && !r.deleted_at)
  return {
    async insertIgnore(row: NewParcel) {
      if (row.fulfillment_id && parcels.rows.some((r) => !r.deleted_at && r.fulfillment_id === row.fulfillment_id && Boolean(r.demo) === row.demo)) return null
      return parcels.insert({ ...PARCEL_DEFAULTS, ...row })
    },
    async claim(id, args) {
      const r = live(id)
      if (!r || r.state !== "pending") return null
      Object.assign(r, { state: "creating", claim_token: args.token, claimed_at: args.now, lease_until: args.leaseUntil, attempts: (r.attempts ?? 0) + 1 })
      return { ...r }
    },
    async finish(id, token, patch) {
      const r = live(id)
      if (!r || r.state !== "creating" || r.claim_token !== token) return false
      apply(r, patch)
      r.claim_token = null
      r.lease_until = null
      return true
    },
    async transition(id, from, patch) {
      const r = live(id)
      if (!r || !from.includes(r.state)) return null
      apply(r, patch)
      return { ...r }
    },
    async applyStatus(id, expected, update: StatusUpdate) {
      const r = live(id)
      if (!r || (r.status ?? "") !== (expected ?? "") || (r.status ?? "") === update.status) return null
      r.status = update.status
      r.status_at = update.at
      r.last_checked_at = update.at
      if (update.tracking_number) r.tracking_number = update.tracking_number
      if (update.offer) r.offer = update.offer
      r.updated_at = new Date()
      return { ...r }
    },
    async touch(id, at) {
      const r = live(id)
      if (r) r.last_checked_at = at
    },
    async claimBuy(id, now) {
      const r = live(id)
      if (!r || r.status !== "offers_prepared") return null
      if (r.buy_requested_at && time(r.buy_requested_at) >= now.getTime() - 10 * 60 * 1000) return null
      r.buy_requested_at = now
      return { ...r }
    },
    async claimDispatch(ids, now) {
      const out: string[] = []
      for (const id of ids) {
        const r = live(id)
        if (r && r.status === "confirmed" && (r.dispatch_state === null || r.dispatch_state === "failed")) {
          r.dispatch_state = "requesting"
          r.dispatch_at = now
          out.push(id)
        }
      }
      return out
    },
    async claimMark(id, field, now) {
      const r = live(id)
      if (!r || r[field]) return false
      r[field] = now
      return true
    },
    async releaseMark(id, field, error) {
      const r = live(id)
      if (r) {
        r[field] = null
        r.status_writer_error = error
      }
    },
    async expireLeases(now, demo) {
      let n = 0
      for (const r of parcels.rows) {
        if (!r.deleted_at && r.state === "creating" && r.lease_until && time(r.lease_until) < now.getTime() && Boolean(r.demo) === demo) {
          Object.assign(r, { state: "unknown", claim_token: null, lease_until: null, error_code: "lease_expired" })
          n += 1
        }
      }
      return n
    },
    async insertEvent(e: NewEvent) {
      if (e.dedupe_key && events.rows.some((r) => !r.deleted_at && r.dedupe_key === e.dedupe_key)) return null
      return events.insert({ status: null, previous_status: null, source: null, message: null, data: null, actor: null, dedupe_key: null, occurred_at: new Date(), ...e })
    },
    async pruneEvents(before) {
      const keep = events.rows.filter((r) => time(r.occurred_at) >= before.getTime())
      const n = events.rows.length - keep.length
      events.rows = keep
      return n
    },
    async setSetting(key, value, updatedBy) {
      const existing = settings.rows.find((r) => r.key === key)
      if (existing) {
        Object.assign(existing, { value, updated_by: updatedBy, updated_at: new Date(), deleted_at: null })
        return { ...existing } as never
      }
      return settings.insert({ key, value, updated_by: updatedBy }) as never
    },
    async claimSetting(key, value) {
      if (settings.rows.some((r) => r.key === key)) return false
      settings.insert({ key, value, updated_by: null })
      return true
    },
    async counts(demo) {
      const map = new Map<string, { state: string; status: string | null; count: number }>()
      for (const r of parcels.rows) {
        if (r.deleted_at || Boolean(r.demo) !== demo) continue
        const key = `${r.state}|${r.status ?? ""}`
        const hit = map.get(key) ?? { state: r.state, status: r.status ?? null, count: 0 }
        hit.count += 1
        map.set(key, hit)
      }
      return [...map.values()]
    },
  }
}

/* ------------------------------------------------------------------ */
/* A fake ShipX organization behind fetch                              */
/* ------------------------------------------------------------------ */

export interface Call {
  method: string
  url: string
  body: any
  auth: string | null
}

export class FakeShipx {
  calls: Call[] = []
  shipments = new Map<string, Row>()
  seq = 1000
  /** The next create fails like this. */
  failCreate: null | { status: number; body?: Row } | "timeout" = null
  /** The next create reaches ShipX but its answer is lost (the shipment exists). */
  loseCreateAnswer = false
  /** Answer of DELETE: ShipX refuses with invalid_action after confirmation. */
  points: Row[] = []

  readonly fetch = async (input: unknown, init?: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response> => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null
    const auth = (init?.headers ?? {})["Authorization"] ?? null
    this.calls.push({ method, url, body, auth })
    const u = new URL(url)
    if (u.hostname !== "api-shipx-pl.easypack24.net" && u.hostname !== "sandbox-api-shipx-pl.easypack24.net") throw new Error(`unexpected host ${u.hostname}`)
    const path = u.pathname
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })

    if (path === "/v1/points") return json(200, { items: this.points.filter((p) => !u.searchParams.get("name") || p.name === u.searchParams.get("name")) })
    if (auth !== `Bearer ${TOKEN}`) return json(401, { status: 401, error: "token_invalid", message: "Token is invalid" })

    let m = path.match(/^\/v1\/organizations\/(\d+)\/shipments$/)
    if (m && method === "POST") {
      if (this.failCreate === "timeout") {
        this.failCreate = null
        const err = new Error("aborted")
        err.name = "AbortError"
        throw err
      }
      if (this.failCreate) {
        const f = this.failCreate
        this.failCreate = null
        return json(f.status, f.body ?? { status: f.status, error: "validation_failed", message: "There are some validation errors.", details: { receiver: { phone: ["invalid"] } } })
      }
      this.seq += 1
      const id = String(this.seq)
      const shipment = { id: Number(id), status: "created", tracking_number: null, reference: body?.reference ?? null, service: body?.service, receiver: body?.receiver, created_at: new Date().toISOString(), offers: [] }
      this.shipments.set(id, shipment)
      if (this.loseCreateAnswer) {
        this.loseCreateAnswer = false
        const err = new Error("socket hang up")
        throw err
      }
      return json(201, shipment)
    }
    if (m && method === "GET") {
      const email = u.searchParams.get("receiver_email")
      const items = [...this.shipments.values()].filter((s) => !email || s.receiver?.email === email)
      return json(200, { items, count: items.length })
    }
    m = path.match(/^\/v1\/organizations\/(\d+)$/)
    if (m && method === "GET") return json(200, { id: Number(m[1]), name: "Koda Supply", status: "active", services: ["inpost_locker_standard", "inpost_courier_standard"] })
    m = path.match(/^\/v1\/organizations\/(\d+)\/dispatch_orders$/)
    if (m && method === "POST") return json(201, { id: 77, status: "new" })
    m = path.match(/^\/v1\/shipments\/(\d+)\/label$/)
    if (m) {
      const s = this.shipments.get(m[1])
      if (!s) return json(404, { status: 404, error: "resource_not_found", message: "not found" })
      if (["created", "offers_prepared", "offer_selected"].includes(s.status)) return json(400, { status: 400, error: "invalid_action", message: "label not available" })
      return new Response(new TextEncoder().encode("%PDF-1.4 fake label content for tests\n%%EOF"), { status: 200, headers: { "content-type": "application/pdf" } })
    }
    m = path.match(/^\/v1\/shipments\/(\d+)\/buy$/)
    if (m && method === "POST") {
      const s = this.shipments.get(m[1])
      if (!s) return json(404, { status: 404, error: "resource_not_found", message: "not found" })
      s.status = "confirmed"
      s.tracking_number = `6${m[1].padStart(23, "0")}`
      return json(200, s)
    }
    m = path.match(/^\/v1\/shipments\/(\d+)$/)
    if (m && method === "GET") {
      const s = this.shipments.get(m[1])
      return s ? json(200, s) : json(404, { status: 404, error: "resource_not_found", message: "not found" })
    }
    if (m && method === "DELETE") {
      const s = this.shipments.get(m[1])
      if (!s) return json(404, { status: 404, error: "resource_not_found", message: "not found" })
      if (!["created", "offers_prepared", "offer_selected"].includes(s.status)) return json(400, { status: 400, error: "invalid_action", message: "Invalid action" })
      s.status = "canceled"
      return new Response(null, { status: 204 })
    }
    return json(404, { status: 404, error: "resource_not_found", message: `no route ${method} ${path}` })
  }

  /** Moves a shipment to a status, as InPost would. */
  set(id: string, status: string, extra: Row = {}): void {
    const s = this.shipments.get(id)
    if (!s) throw new Error(`no shipment ${id}`)
    Object.assign(s, { status }, extra)
  }
}

/* ------------------------------------------------------------------ */
/* The fake Medusa container                                           */
/* ------------------------------------------------------------------ */

export interface Setup {
  container: { resolve: (key: string, opts?: { allowUnregistered?: boolean }) => any }
  parcels: Table
  events: Table
  settings: Table
  store: ParcelStore
  emitted: Array<{ name: string; data: Row }>
  logs: string[]
  orders: Map<string, Row>
  fake: FakeShipx
}

export function setup(options: InpostPluginOptions, orders: Row[] = [], fake: FakeShipx = new FakeShipx()): Setup {
  const o = resolveOptions(options)
  const parcels = new Table("inpar")
  const events = new Table("inpev")
  const settings = new Table("inset")
  const store = memoryStore(parcels, events, settings)
  const logs: string[] = []
  const log = (level: string) => (msg: string) => void logs.push(`${level} ${msg}`)
  const svc = {
    getOptions: () => o,
    getLogger: () => ({ info: log("info"), warn: log("warn"), error: log("error"), debug: log("debug") }),
    isDemo: () => o.demo,
    isConfigured: () => o.demo || (Boolean(o.apiToken) && Boolean(o.organizationId)),
    missingOptions: () => (o.demo ? [] : [...(o.apiToken ? [] : ["apiToken"]), ...(o.organizationId ? [] : ["organizationId"])]),
    mask: (s: string) => maskSecrets(s, [o.apiToken, o.webhookSecret]),
    listInpostParcels: async (f: Row, c: Row) => parcels.list(f, c),
    listAndCountInpostParcels: async (f: Row, c: Row) => [parcels.list(f, c), parcels.list(f).length],
    createInpostParcels: async (d: Row | Row[]) => (Array.isArray(d) ? d.map((x) => parcels.insert({ ...PARCEL_DEFAULTS, ...x })) : parcels.insert({ ...PARCEL_DEFAULTS, ...d })),
    deleteInpostParcels: async (ids: string[]) => void (parcels.rows = parcels.rows.filter((r) => !ids.includes(r.id))),
    listInpostParcelEvents: async (f: Row, c: Row) => events.list(f, c),
    listAndCountInpostParcelEvents: async (f: Row, c: Row) => [events.list(f, c), events.list(f).length],
    deleteInpostParcelEvents: async (ids: string[]) => void (events.rows = events.rows.filter((r) => !ids.includes(r.id))),
    listInpostSettings: async (f: Row, c: Row) => settings.list(f, c),
    deleteInpostSettings: async (ids: string[]) => void (settings.rows = settings.rows.filter((r) => !ids.includes(r.id))),
  }
  const orderMap = new Map(orders.map((x) => [x.id, x]))
  const emitted: Array<{ name: string; data: Row }> = []
  const client = createShipxClient({ token: o.apiToken, organizationId: o.organizationId, sandbox: o.sandbox, requestsPerMinute: 60000, timeoutMs: 2000, fetchImpl: fake.fetch as unknown as typeof fetch, sleep: async () => {} })
  const registry: Record<string, unknown> = {
    inpost: svc,
    inpostParcelStore: store,
    inpostShipxClient: client,
    query: {
      graph: async ({ entity, filters, pagination }: Row) => {
        if (entity !== "order") throw new Error(`Query does not know the entity "${entity}"`)
        const ids: string[] | null = filters?.id ? (Array.isArray(filters.id) ? filters.id : [filters.id]) : null
        let data = ids ? ids.filter((id) => orderMap.has(id)).map((id) => orderMap.get(id)) : [...orderMap.values()]
        data = data.map((x) => structuredClone(x))
        if (pagination?.order?.created_at === "DESC") data = data.sort((a: Row, b: Row) => time(b.created_at) - time(a.created_at))
        if (pagination?.take) data = data.slice(0, pagination.take)
        return { data }
      },
    },
    event_bus: { emit: async (e: { name: string; data: Row }) => void emitted.push(e) },
  }
  const container = {
    resolve: (key: string, opts?: { allowUnregistered?: boolean }) => {
      if (!(key in registry)) {
        if (opts?.allowUnregistered) return undefined
        throw new Error(`not registered: ${key}`)
      }
      return registry[key]
    },
  }
  return { container, parcels, events, settings, store, emitted, logs, orders: orderMap, fake }
}

/** Arms a writer in the store, as the admin route does. */
export async function arm(s: Setup, writer: "shipment" | "fulfillmentStatus", demo = false): Promise<void> {
  await s.store.setSetting(`${demo ? "demo" : "live"}:writer:${writer}`, { on: true }, "user_01TEST")
}

/* ------------------------------------------------------------------ */
/* An order                                                            */
/* ------------------------------------------------------------------ */

export function order(overrides: Row = {}): Row {
  return {
    id: "order_01KODASUPPLY000000000001",
    display_id: 1042,
    status: "pending",
    email: "anna.nowak@example.com",
    currency_code: "pln",
    created_at: "2026-10-05T09:15:00.000Z",
    total: 199.99,
    metadata: {},
    customer: { email: "anna.nowak@example.com" },
    shipping_address: {
      first_name: "Anna",
      last_name: "Nowak",
      company: null,
      address_1: "ul. Przykładowa 5/2",
      address_2: "",
      city: "Warszawa",
      postal_code: "00950",
      country_code: "pl",
      phone: "+48 000 000 001",
    },
    items: [
      { id: "ordli_1", quantity: 2, variant: { weight: 450 } },
      { id: "ordli_2", quantity: 1, variant: { weight: 300 } },
    ],
    payment_collections: [],
    shipping_methods: [{ id: "ordsm_1", name: "InPost Paczkomat", data: { type: "paczkomat", cod: false, machine_id: "KSP01M", machine_name: "KSP01M", machine_address: { line1: "ul. Narzędziowa 12", line2: "00-950 Warszawa", city: "Warszawa", post_code: "00-950" } } }],
    fulfillments: [],
    ...overrides,
  }
}

/** A fulfillment of the InPost provider on an order, with the data the provider recorded. */
export function withFulfillment(o: Row, data: Row, id = "ful_01TEST0000000000000000001"): Row {
  return {
    ...o,
    fulfillments: [
      ...(o.fulfillments ?? []),
      { id, provider_id: "inpost_inpost", data, canceled_at: null, shipped_at: null, delivered_at: null, items: [{ line_item_id: "ordli_1", quantity: 2 }, { line_item_id: "ordli_2", quantity: 1 }] },
    ],
  }
}

/** Waits for work started with setImmediate (inBackground) to settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
}
