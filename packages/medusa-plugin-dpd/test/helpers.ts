/**
 * Test doubles shared by the tests (this file is not a test itself: the
 * runner picks up `*.test.ts` only).
 *
 *   Table   rows filtered like the generated service filters them
 *   memoryStore  the atomic store with the SAME rules as the SQL one: one
 *                row per fulfillment, kind and mode, transitions only from
 *                the given states and only on PATCHABLE_COLUMNS, events
 *                deduplicated, one setting per key, the groups of groupOf,
 *                claims with a token and a lease, finish by the owner only,
 *                leases that ran out taken back
 *   setup   a fake Medusa container: the DPD module service (the generated
 *           CRUD of the five tables over Tables, the options, masking),
 *           the memory store, Query over a list of orders, the event bus,
 *           a logger, the fulfillment module (retrieve and update of the
 *           fulfillments of the orders) and, given a FakeDpdServices, the
 *           DPDServices client over its fetch under "dpdServicesClient"
 *   settle  waits until the work started in the background is done
 *
 * Nothing here reaches a network: without a fake the client is the demo
 * client (demo mode) or none.
 */
import { resolveOptions, missingOptions, secretsOf, type DpdPluginOptions, type ResolvedDpdOptions } from "../src/modules/dpd/lib/options.ts"
import { maskSecrets } from "../src/modules/dpd/lib/security.ts"
import { senderProblems } from "../src/modules/dpd/lib/sender.ts"
import { groupOf } from "../src/modules/dpd/lib/contract.ts"
import { createDpdServicesClient } from "../src/modules/dpd/lib/dpdservices.ts"
import {
  CLAIMED_STATES,
  LABEL_LEASE_EXPIRED_ERROR,
  LEASE_EXPIRED_ERROR,
  PATCHABLE_COLUMNS,
  searchText,
  type DpdStore,
  type NewEvent,
  type NewShipment,
} from "../src/modules/dpd/lib/store.ts"
import type { FakeDpdServices } from "./fake-dpdservices.ts"

export type Row = Record<string, unknown>

/** Made-up credentials: long enough to be masked, never real. */
export const PASSWORD = "test-password-koda-0000"
export const API_KEY = "testkeykoda0000000000"

/** A complete sandbox setup with a sender that fits every DPD limit. */
export const SANDBOX: DpdPluginOptions = {
  login: "koda-test",
  password: PASSWORD,
  masterFid: "1000",
  sender: {
    company: "Koda Supply",
    name: "Anna Nowak",
    phone: "+48 000 000 001",
    email: "shop@example.com",
    street: "ul. Przykładowa 5",
    city: "Warszawa",
    postalCode: "00-950",
  },
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function time(v: unknown): number {
  return v instanceof Date ? v.getTime() : new Date(String(v)).getTime()
}

/** A comparable value: numbers as numbers, dates and date strings as their time. */
function comparable(v: unknown): number {
  return typeof v === "number" ? v : time(v)
}

function sortKey(v: unknown): number | string | null {
  if (v instanceof Date) return v.getTime()
  if (typeof v === "number" || typeof v === "string") return v
  return null
}

/**
 * A row against a filter of the generated service's list methods (MikroORM):
 * a value, null (is null), an array (in), $or and $and, and the operators
 * $in, $nin, $ne, $lt, $lte, $gt, $gte, $ilike. As in SQL, a NULL column
 * matches no comparison: `$ne: "x"` and `$nin` leave out the rows where the
 * column is null (only `$ne: null`, is not null, is about null itself).
 */
export function matches(row: Row, filter: Row): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$or") {
      if (!(cond as Row[]).some((f) => matches(row, f))) return false
      continue
    }
    if (key === "$and") {
      if (!(cond as Row[]).every((f) => matches(row, f))) return false
      continue
    }
    const v = row[key]
    if (Array.isArray(cond)) {
      if (!cond.includes(v)) return false
    } else if (cond === null) {
      if (v !== null && v !== undefined) return false
    } else if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row
      const isNull = v === null || v === undefined
      const compare = (bound: unknown, ok: (a: number, b: number) => boolean) => !isNull && ok(comparable(v), comparable(bound))
      if ("$in" in c && (isNull || !(c.$in as unknown[]).includes(v))) return false
      if ("$nin" in c && (isNull || (c.$nin as unknown[]).includes(v))) return false
      if ("$ne" in c && (c.$ne === null ? isNull : isNull || v === c.$ne)) return false
      if ("$lt" in c && !compare(c.$lt, (a, b) => a < b)) return false
      if ("$lte" in c && !compare(c.$lte, (a, b) => a <= b)) return false
      if ("$gt" in c && !compare(c.$gt, (a, b) => a > b)) return false
      if ("$gte" in c && !compare(c.$gte, (a, b) => a >= b)) return false
      if ("$ilike" in c) {
        const needle = String(c.$ilike).replace(/^%|%$/g, "").toLowerCase()
        if (!String(v ?? "").toLowerCase().includes(needle)) return false
      }
    } else if (v !== cond) return false
  }
  return true
}

export type ListConfig = { skip?: number; take?: number | null; order?: Record<string, string> }

export class Table {
  rows: Row[] = []
  private seq = 0
  private readonly prefixName: string
  private readonly defaults: Row

  constructor(prefixName: string, defaults: Row = {}) {
    this.prefixName = prefixName
    this.defaults = defaults
  }

  nextId(): string {
    this.seq += 1
    return `${this.prefixName}_${String(this.seq).padStart(4, "0")}`
  }

  list(filter: Row = {}, config: ListConfig = {}): Row[] {
    let found = this.rows.filter((r) => !r.deleted_at && matches(r, filter))
    if (config.order) {
      const keys = Object.entries(config.order)
      found = [...found].sort((a, b) => {
        for (const [k, dir] of keys) {
          const x = sortKey(a[k])
          const y = sortKey(b[k])
          if (x === y) continue
          if (x === null) return 1
          if (y === null) return -1
          return (x < y ? -1 : 1) * (dir.toUpperCase() === "DESC" ? -1 : 1)
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
    const row: Row = { id: this.nextId(), created_at: now, updated_at: now, deleted_at: null, ...this.defaults, ...data }
    this.rows.push(row)
    return { ...row }
  }

  update(data: Row): Row {
    const row = this.rows.find((r) => r.id === data.id)
    if (!row) throw new Error(`${this.prefixName}: no row ${String(data.id)}`)
    Object.assign(row, data, { updated_at: new Date() })
    return { ...row }
  }

  remove(ids: string[]): void {
    this.rows = this.rows.filter((r) => !ids.includes(String(r.id)))
  }
}

/** Defaults of the columns, as the migration gives them. */
export const SHIPMENT_DEFAULTS: Row = { kind: "outbound", state: "pending", attempts: 0 }
export const DISPATCH_DEFAULTS: Row = { state: "pending" }
export const DOCUMENT_DEFAULTS: Row = { format: "PDF" }

/* ------------------------------------------------------------------ */
/* The atomic store in memory                                          */
/* ------------------------------------------------------------------ */

/** Every column of a new shipment row, as the migration gives them. */
const NEW_SHIPMENT_COLUMNS: Row = {
  references: null,
  boxes: null,
  waybills: null,
  session_id: null,
  status: null,
  stage: null,
  plan_hash: null,
  problems: null,
  dispatch_id: null,
  handed_over_at: null,
  claim_token: null,
  lease_until: null,
  shipped_marked_at: null,
  delivered_marked_at: null,
  last_checked_at: null,
  error: null,
  error_code: null,
  attempts: 0,
}

/** The Panel group of a memory row, by the rule of the admin (groupOf). */
export function groupOfRow(r: Row): string {
  const stage = typeof r.stage === "string" ? r.stage : null
  return groupOf({
    kind: r.kind === "return" ? "return" : "outbound",
    state: r.state as never,
    stage: stage as never,
    handedOver: Boolean(r.handed_over_at),
  })
}

function searchHit(r: Row, q: string): boolean {
  const s = searchText(q)
  if (!s) return true
  const needle = s.toLowerCase()
  const has = (v: unknown) => typeof v === "string" && v.toLowerCase().includes(needle)
  if (r.order_id === s || r.fulfillment_id === s) return true
  if (/^\d{1,9}$/.test(s) && r.display_id === Number(s)) return true
  if (has(r.pudo_id) || has(r.reference)) return true
  return Array.isArray(r.waybills) && r.waybills.some(has)
}

export function memoryStore(shipments: Table, events: Table, settings: Table): DpdStore {
  const live = (id: string) => shipments.rows.find((r) => r.id === id && !r.deleted_at)
  const apply = (r: Row, patch: object, withState: boolean) => {
    const values = patch as Row
    for (const column of PATCHABLE_COLUMNS) {
      if (!withState && column === "state") continue
      if (column in values && values[column] !== undefined) r[column] = values[column]
    }
  }
  return {
    async claim(id, from, args) {
      const r = live(id)
      if (from.length === 0 || !r || !from.includes(String(r.state))) return null
      apply(r, args.patch ?? {}, false)
      Object.assign(r, { state: args.to, claim_token: args.token, lease_until: args.leaseUntil, attempts: Number(r.attempts ?? 0) + 1, updated_at: new Date() })
      return { ...r } as never
    },
    async finish(id, token, patch, options) {
      const r = live(id)
      if (!r || !CLAIMED_STATES.includes(String(r.state)) || r.claim_token !== token) return null
      apply(r, patch, true)
      Object.assign(r, { claim_token: null, lease_until: null, updated_at: options?.unsent?.updatedAt ?? new Date() })
      if (options?.unsent) r.attempts = Math.max(Number(r.attempts ?? 0) - 1, 0)
      return { ...r } as never
    },
    async expireLeases(mode, now) {
      const out: Row[] = []
      for (const r of shipments.rows) {
        if (r.deleted_at || r.mode !== mode || !(r.lease_until instanceof Date) || r.lease_until.getTime() >= now.getTime()) continue
        if (r.state === "creating") Object.assign(r, { state: "unknown", error_code: "lease_expired", error: LEASE_EXPIRED_ERROR })
        else if (r.state === "labeling") Object.assign(r, { state: "created", error_code: "label_lease_expired", error: LABEL_LEASE_EXPIRED_ERROR })
        else continue
        Object.assign(r, { claim_token: null, lease_until: null, updated_at: new Date() })
        out.push({ ...r })
      }
      return out as never
    },
    async insertIgnore(row: NewShipment) {
      if (row.fulfillment_id && shipments.rows.some((r) => !r.deleted_at && r.fulfillment_id === row.fulfillment_id && r.kind === row.kind && r.mode === row.mode)) return null
      return shipments.insert({ ...NEW_SHIPMENT_COLUMNS, ...row, problems: row.problems ?? null }) as never
    },
    async transition(id, from, patch) {
      const r = live(id)
      if (!r || !from.includes(String(r.state))) return null
      const values = patch as Row
      for (const column of PATCHABLE_COLUMNS) if (column in values && values[column] !== undefined) r[column] = values[column]
      r.updated_at = new Date()
      return { ...r } as never
    },
    async insertEvent(e: NewEvent) {
      if (e.dedupe_key && events.rows.some((r) => !r.deleted_at && r.dedupe_key === e.dedupe_key)) return null
      return events.insert({
        dispatch_id: null,
        waybill: null,
        status: null,
        previous_status: null,
        source: null,
        data: null,
        actor: null,
        dedupe_key: null,
        object_id: null,
        occurred_at: new Date(),
        ...e,
        message: e.message ? e.message.slice(0, 2000) : null,
      }) as never
    },
    async setSetting(key, value, updatedBy) {
      const existing = settings.rows.find((r) => r.key === key && !r.deleted_at)
      if (existing) {
        Object.assign(existing, { value, updated_by: updatedBy, updated_at: new Date() })
        return { ...existing } as never
      }
      return settings.insert({ key, value, updated_by: updatedBy }) as never
    },
    async claimSetting(key, value) {
      if (settings.rows.some((r) => r.key === key && !r.deleted_at)) return false
      settings.insert({ key, value, updated_by: null })
      return true
    },
    async releaseSetting(key) {
      settings.rows = settings.rows.filter((r) => r.key !== key)
    },
    async counts(mode) {
      const map = new Map<string, number>()
      for (const r of shipments.rows) {
        if (r.deleted_at || r.mode !== mode) continue
        const g = groupOfRow(r)
        map.set(g, (map.get(g) ?? 0) + 1)
      }
      return [...map.entries()].map(([group, count]) => ({ group: group as never, count }))
    },
    async list(args) {
      const found = shipments.rows
        .filter((r) => !r.deleted_at && r.mode === args.mode)
        .filter((r) => args.filter === "all" || groupOfRow(r) === args.filter)
        .filter((r) => searchHit(r, String(args.q ?? "")))
        .sort((a, b) => time(b.created_at) - time(a.created_at) || (String(a.id) < String(b.id) ? 1 : String(a.id) > String(b.id) ? -1 : 0))
      return { rows: found.slice(args.offset, args.offset + args.limit).map((r) => ({ ...r })) as never, count: found.length }
    },
  }
}

/* ------------------------------------------------------------------ */
/* The fake Medusa container                                           */
/* ------------------------------------------------------------------ */

/** A row of the fake fulfillment module: its id and the provider data the plugin merges into. */
export type FakeFulfillment = { id: string; data: Row }

export type Container = { resolve: <T = unknown>(key: string, opts?: { allowUnregistered?: boolean }) => T }

export type Setup = {
  container: Container
  options: ResolvedDpdOptions
  shipments: Table
  documents: Table
  events: Table
  dispatches: Table
  settings: Table
  store: DpdStore
  emitted: Array<{ name: string; data: Row }>
  logs: string[]
  orders: Map<string, Row>
  /** The fulfillment module's rows (id, data), filled from the orders' fulfillments. */
  fulfillments: Map<string, FakeFulfillment>
  fake: FakeDpdServices | null
}

export type SetupExtra = {
  /** The DPDServices behind the client; without one no client is registered. */
  fake?: FakeDpdServices
  /** Registers no fulfillment module (as when Medusa has none). */
  noFulfillmentModule?: boolean
  /** The pace of the client over the fake (default: so fast it never waits); a slow one makes the pacing refuse calls without sending them. */
  requestsPerMinute?: number
}

/** Waits until the work started with setImmediate (inBackground) and its promises are done. */
export async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise<void>((resolve) => setImmediate(resolve))
}

/** The generated CRUD of one table, under Medusa's method names (`listDpdShipments`, `createDpdShipments`...). */
function crud(singular: string, plural: string, table: Table): Record<string, (...args: never[]) => Promise<unknown>> {
  return {
    [`list${plural}`]: async (f: Row = {}, c: ListConfig = {}) => table.list(f, c),
    [`listAndCount${plural}`]: async (f: Row = {}, c: ListConfig = {}) => [table.list(f, c), table.list(f).length],
    [`retrieve${singular}`]: async (id: string) => {
      const row = table.list({ id })[0]
      if (!row) throw new Error(`${singular} ${id} was not found`)
      return row
    },
    [`create${plural}`]: async (d: Row | Row[]) => (Array.isArray(d) ? d.map((x) => table.insert(x)) : table.insert(d)),
    [`update${plural}`]: async (d: Row | Row[]) => (Array.isArray(d) ? d.map((x) => table.update(x)) : table.update(d)),
    [`delete${plural}`]: async (ids: string | string[]) => void table.remove(Array.isArray(ids) ? ids : [ids]),
  }
}

export function setup(options: DpdPluginOptions, orders: Row[] = [], extra: SetupExtra = {}): Setup {
  const o = resolveOptions(options)
  const shipments = new Table("dpdshp", SHIPMENT_DEFAULTS)
  const documents = new Table("dpddoc", DOCUMENT_DEFAULTS)
  const events = new Table("dpdevt")
  const dispatches = new Table("dpddsp", DISPATCH_DEFAULTS)
  const settings = new Table("dpdset")
  const store = memoryStore(shipments, events, settings)
  const logs: string[] = []
  const log = (level: string) => (msg: string) => void logs.push(`${level} ${msg}`)
  const svc = {
    getOptions: () => o,
    getLogger: () => ({ info: log("info"), warn: log("warn"), error: log("error"), debug: log("debug") }),
    isDemo: () => o.demo,
    mode: () => o.mode,
    isConfigured: () => missingOptions(o).length === 0,
    missingOptions: () => missingOptions(o),
    senderProblems: () => senderProblems(o),
    mask: (s: string) => maskSecrets(s, secretsOf(o)),
    ...crud("DpdShipment", "DpdShipments", shipments),
    ...crud("DpdDocument", "DpdDocuments", documents),
    ...crud("DpdEvent", "DpdEvents", events),
    ...crud("DpdDispatch", "DpdDispatches", dispatches),
    ...crud("DpdSetting", "DpdSettings", settings),
  }
  const orderMap = new Map(orders.map((x) => [String(x.id), x]))
  const emitted: Array<{ name: string; data: Row }> = []
  const registry: Record<string, unknown> = {
    dpd: svc,
    dpdShipmentStore: store,
    logger: svc.getLogger(),
    query: {
      graph: async ({ entity, filters, pagination }: { entity: string; filters?: Row; pagination?: { take?: number; order?: Row } }) => {
        if (entity !== "order") throw new Error(`Query does not know the entity "${entity}"`)
        const raw = filters?.id
        const ids = raw === undefined ? null : (Array.isArray(raw) ? raw : [raw]).map(String)
        let data = (ids ? ids.filter((id) => orderMap.has(id)).map((id) => orderMap.get(id) as Row) : [...orderMap.values()]).map((x) => structuredClone(x))
        if (pagination?.order?.created_at === "DESC") data = data.sort((a, b) => time(b.created_at) - time(a.created_at))
        if (pagination?.take) data = data.slice(0, pagination.take)
        return { data }
      },
    },
    event_bus: { emit: async (e: { name: string; data: Row } | Array<{ name: string; data: Row }>) => void emitted.push(...(Array.isArray(e) ? e : [e])) },
  }
  const fulfillments = new Map<string, FakeFulfillment>()
  for (const o of orders) {
    for (const f of (o.fulfillments as Row[] | undefined) ?? []) fulfillments.set(String(f.id), { id: String(f.id), data: structuredClone((f.data as Row | null | undefined) ?? {}) })
  }
  if (!extra.noFulfillmentModule) {
    registry.fulfillment = {
      retrieveFulfillment: async (id: string) => {
        const f = fulfillments.get(id)
        if (!f) throw new Error(`Fulfillment with id: ${id} was not found`)
        return structuredClone(f)
      },
      updateFulfillment: async (id: string, data: Row) => {
        const f = fulfillments.get(id)
        if (!f) throw new Error(`Fulfillment with id: ${id} was not found`)
        Object.assign(f, structuredClone(data))
        return structuredClone(f)
      },
    }
  }
  const fake = extra.fake ?? null
  if (fake) {
    registry.dpdServicesClient = createDpdServicesClient({
      host: fake.host,
      login: fake.login,
      password: fake.password,
      masterFid: 1000,
      requestsPerMinute: extra.requestsPerMinute ?? 600_000,
      fetchImpl: fake.fetch,
      sleep: async () => {},
    })
  }
  const container: Container = {
    resolve: <T = unknown>(key: string, opts?: { allowUnregistered?: boolean }): T => {
      if (!(key in registry)) {
        if (opts?.allowUnregistered) return undefined as T
        throw new Error(`not registered: ${key}`)
      }
      return registry[key] as T
    },
  }
  return { container, options: o, shipments, documents, events, dispatches, settings, store, emitted, logs, orders: orderMap, fulfillments, fake }
}

/** Arms a writer in the settings table, as the admin route does. */
export function arm(s: Setup, writer: "shipment" | "pickup" | "fulfillmentStatus", on = true): void {
  const key = `${s.options.mode}:writer:${writer}`
  const row = s.settings.rows.find((r) => r.key === key)
  if (row) Object.assign(row, { value: { on }, updated_by: "user_01TEST", updated_at: new Date() })
  else s.settings.insert({ key, value: { on }, updated_by: "user_01TEST" })
}

/** An order of the shape Query returns, with a DPD shipping method. */
export function order(overrides: Row = {}): Row {
  return {
    id: "order_01",
    display_id: 1042,
    currency_code: "pln",
    email: "anna@example.com",
    created_at: new Date("2026-11-02T10:00:00Z"),
    total: 249.9,
    shipping_address: { first_name: "Anna", last_name: "Nowak", address_1: "ul. Przykładowa 5/2", city: "Warszawa", postal_code: "00-950", country_code: "pl", phone: "+48 000 000 002" },
    shipping_methods: [{ id: "sm_01", name: "DPD courier", shipping_option_id: "so_01", data: { dpd_option: "dpd-courier", dpd_kind: "courier", dpd_cod: false, dpd_pudo_id: null, dpd_country: "PL" } }],
    fulfillments: [],
    ...overrides,
  }
}
