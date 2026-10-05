/**
 * In-memory stand-ins for the flow tests: the generated module service (every
 * `list*`, `listAndCount*`, `create*`, `update*`, `delete*` of every table,
 * with the unique indexes of the migrations), a container, and a scripted
 * connector.php. Not a test file itself (the runner picks `*.test.ts`).
 */
import { resolveOptions, type BaseLinkerPluginOptions } from "../src/modules/baselinker/lib/options.ts"
import { maskSecrets } from "../src/modules/baselinker/lib/security.ts"

export type Row = Record<string, any>

function cmp(a: unknown, b: unknown): number {
  const x = a instanceof Date ? a.getTime() : typeof a === "string" && /^\d{4}-\d\d-\d\dT/.test(a) ? new Date(a).getTime() : a
  const y = b instanceof Date ? b.getTime() : typeof b === "string" && /^\d{4}-\d\d-\d\dT/.test(b) ? new Date(b).getTime() : b
  if (x === y) return 0
  if (x === null || x === undefined) return -1
  if (y === null || y === undefined) return 1
  return (x as number) < (y as number) ? -1 : 1
}

export function matches(row: Row, filter: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(filter ?? {})) {
    if (key === "$or") {
      if (!(cond as Array<Record<string, unknown>>).some((f) => matches(row, f))) return false
      continue
    }
    const v = row[key]
    if (Array.isArray(cond)) {
      if (!cond.includes(v)) return false
    } else if (cond === null) {
      if (v !== null && v !== undefined) return false
    } else if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ("$ne" in c && (c.$ne === null ? v === null || v === undefined : v === c.$ne)) return false
      if ("$in" in c && !(c.$in as unknown[]).includes(v)) return false
      if ("$lte" in c && !(v !== null && v !== undefined && cmp(v, c.$lte) <= 0)) return false
      if ("$lt" in c && !(v !== null && v !== undefined && cmp(v, c.$lt) < 0)) return false
      if ("$gte" in c && !(v !== null && v !== undefined && cmp(v, c.$gte) >= 0)) return false
      if ("$gt" in c && !(v !== null && v !== undefined && cmp(v, c.$gt) > 0)) return false
    } else if (v !== cond) return false
  }
  return true
}

/** Unique indexes of the migrations, by table. */
const UNIQUE: Record<string, string[]> = {
  Products: ["bl_product_id", "demo"],
  Orders: ["order_id", "demo"],
  Settings: ["key", "demo"],
  Quarantines: ["kind", "item_key", "demo"],
  Imports: ["bl_order_id", "demo"],
  Returns: ["bl_return_id", "demo"],
  Invoices: ["document_id", "demo"],
}

const PREFIX: Record<string, string> = {
  Products: "blprod",
  Orders: "blord",
  StockChanges: "blstk",
  SyncRuns: "blrun",
  Settings: "blset",
  PlanItems: "blpln",
  Quarantines: "blqua",
  Imports: "blimp",
  Returns: "blret",
  Invoices: "blinv",
}

export class Table {
  rows: Row[] = []
  private seq = 0
  readonly name: string
  constructor(name: string) {
    this.name = name
  }
  list(filter: Record<string, unknown> = {}, config: { skip?: number; take?: number | null; order?: Record<string, string> } = {}): Row[] {
    let found = this.rows.filter((r) => matches(r, filter))
    if (config.order) {
      const keys = Object.entries(config.order)
      found = [...found].sort((a, b) => {
        for (const [k, dir] of keys) {
          const c = cmp(a[k], b[k])
          if (c !== 0) return String(dir).toUpperCase() === "DESC" ? -c : c
        }
        return 0
      })
    }
    const skip = config.skip ?? 0
    const take = config.take === null || config.take === undefined ? found.length : config.take
    return found.slice(skip, skip + take).map((r) => ({ ...r }))
  }
  create(data: Row | Row[]): Row | Row[] {
    const one = (d: Row) => {
      const row = { id: `${PREFIX[this.name] ?? "row"}_${++this.seq}`, created_at: new Date(), updated_at: new Date(), ...d }
      const unique = UNIQUE[this.name]
      if (unique && this.rows.some((r) => unique.every((k) => r[k] === row[k]))) throw new Error(`unique violation on ${this.name}`)
      this.rows.push(row)
      return { ...row }
    }
    return Array.isArray(data) ? data.map(one) : one(data)
  }
  update(data: Row | Row[]): Row | Row[] {
    const one = (d: Row) => {
      const row = this.rows.find((r) => r.id === d.id)
      if (!row) throw new Error(`no row ${d.id} in ${this.name}`)
      Object.assign(row, d, { updated_at: new Date() })
      return { ...row }
    }
    return Array.isArray(data) ? data.map(one) : one(data)
  }
  delete(ids: string | string[]): void {
    const list = Array.isArray(ids) ? ids : [ids]
    this.rows = this.rows.filter((r) => !list.includes(r.id))
  }
}

export interface FakeService {
  svc: any
  tables: Record<string, Table>
  table(name: string): Table
  logs: string[]
}

/** The module service as the flows see it: options, masking and the generated CRUD of every table. */
export function fakeService(options: BaseLinkerPluginOptions): FakeService {
  const o = resolveOptions(options)
  const tables: Record<string, Table> = {}
  const table = (name: string) => (tables[name] ??= new Table(name))
  const logs: string[] = []
  const logger = {
    info: (m: string) => void logs.push(`info ${m}`),
    warn: (m: string) => void logs.push(`warn ${m}`),
    error: (m: string) => void logs.push(`error ${m}`),
  }
  const base: Record<string, unknown> = {
    getOptions: () => o,
    getLogger: () => logger,
    isDemo: () => o.demo,
    isConfigured: () => true,
    missingOptions: () => [],
    mask: (s: string) => maskSecrets(s, [o.apiToken]),
  }
  const svc = new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop]
      const m = /^(listAndCount|list|create|update|delete)BaseLinker(\w+)$/.exec(prop)
      if (!m) return undefined
      const [, op, name] = m
      const t = table(name)
      if (op === "list") return async (f: Row = {}, c: Row = {}) => t.list(f, c)
      if (op === "listAndCount") return async (f: Row = {}, c: Row = {}) => [t.list(f, c), t.list(f, {}).length]
      if (op === "create") return async (d: Row | Row[]) => t.create(d)
      if (op === "update") return async (d: Row | Row[]) => t.update(d)
      return async (ids: string | string[]) => t.delete(ids)
    },
  })
  return { svc, tables, table, logs }
}

export function fakeContainer(registry: Record<string, unknown>) {
  return {
    resolve: (key: string) => {
      if (!(key in registry)) throw new Error(`not registered: ${key}`)
      return registry[key]
    },
  }
}

export interface ConnectorCall {
  method: string
  params: Row
}

/**
 * A scripted connector.php: a handler per method name returning the body
 * (status SUCCESS is added), an Error to throw (a network failure), or a
 * `{ status: "ERROR", ... }` body. Any other URL or method fails the test.
 */
export function scriptedBaseLinker(handlers: Record<string, (params: Row, call: number) => unknown>) {
  const calls: ConnectorCall[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url) !== "https://api.baselinker.com/connector.php") throw new Error(`unexpected URL ${String(url)}`)
    const body = new URLSearchParams(String(init?.body ?? ""))
    const method = body.get("method") ?? ""
    const params = JSON.parse(body.get("parameters") ?? "{}") as Row
    calls.push({ method, params })
    const handler = handlers[method]
    if (!handler) return new Response(JSON.stringify({ status: "ERROR", error_code: "ERROR_UNKNOWN_METHOD", error_message: method }))
    const out = handler(params, calls.filter((c) => c.method === method).length)
    if (out instanceof Error) throw out
    const reply = out && typeof out === "object" && (out as Row).status === "ERROR" ? out : { status: "SUCCESS", ...(out as Row) }
    return new Response(JSON.stringify(reply))
  }) as typeof fetch
  return {
    calls,
    methods: () => calls.map((c) => c.method),
    restore: () => {
      globalThis.fetch = real
    },
  }
}

/** A Query stand-in: one handler per entity. */
export function fakeQuery(entities: Record<string, (args: Row) => Row[]>) {
  return {
    graph: async (args: Row) => ({ data: (entities[args.entity] ?? (() => []))(args) }),
  }
}

export const silentEvents = () => {
  const events: Array<{ name: string; data: Row }> = []
  return { events, bus: { emit: async (e: { name: string; data: Row }) => void events.push(e) } }
}
