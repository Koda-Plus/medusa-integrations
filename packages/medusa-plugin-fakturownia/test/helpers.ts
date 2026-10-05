/**
 * Test doubles shared by the flow tests (this file is not a test itself: the
 * runner picks up `*.test.ts` only).
 *
 *   Table           rows filtered like the generated service filters them
 *   memoryStore     the atomic store with the SAME rules as the SQL one: the
 *                   two unique indexes, the conditional claim, finish only for
 *                   the claim's owner, transitions only from given states
 *   setup           a fake Medusa container (module service, query, event
 *                   bus, the store) around one set of plugin options
 *   FakeFakturownia a scripted Fakturownia account behind `fetch`: it keeps
 *                   documents, answers the documented endpoints, can lose
 *                   answers on purpose, and records every call
 */
import { maskSecrets } from "../src/modules/fakturownia/lib/security.ts"
import { resolveOptions, type FakturowniaPluginOptions } from "../src/modules/fakturownia/lib/options.ts"
import { PATCHABLE_COLUMNS, type DocumentPatch, type DocumentStore, type NewDocument } from "../src/modules/fakturownia/lib/store.ts"
import { warsawDate } from "../src/modules/fakturownia/lib/dates.ts"

export type Row = Record<string, any>

export const TOKEN = "fkTEST0123456789abcdefGHIJ/mojafirma"
export const LIVE: FakturowniaPluginOptions = { apiToken: TOKEN, account: "mojafirma", requestsPerMinute: 600 }

/** Today in Poland, as the plugin dates documents. */
export const today = () => warsawDate(new Date())

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
    const v = row[key]
    if (Array.isArray(cond)) {
      if (!cond.includes(v)) return false
    } else if (cond === null) {
      if (v !== null && v !== undefined) return false
    } else if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>
      if ("$ne" in c && (c.$ne === null ? v === null || v === undefined : v === c.$ne)) return false
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
          if (x === null || x === undefined) return -1
          if (y === null || y === undefined) return 1
          return (x < y ? -1 : 1) * (String(dir).toUpperCase() === "DESC" ? -1 : 1)
        }
        return 0
      })
    }
    const skip = config.skip ?? 0
    const take = config.take === null || config.take === undefined ? found.length : config.take
    return found.slice(skip, skip + take).map((r) => ({ ...r }))
  }

  update(data: Row): Row {
    const row = this.rows.find((r) => r.id === data.id)
    if (!row) throw new Error(`no row ${data.id}`)
    Object.assign(row, data, { updated_at: new Date() })
    return { ...row }
  }
}

const EMPTY_DOCUMENT: Row = {
  fakturownia_id: null,
  number: null,
  oid: null,
  issue_date: null,
  currency: null,
  total_gross: null,
  positions: null,
  buyer_type: null,
  from_fakturownia_id: null,
  paid: false,
  paid_at: null,
  pay_requested_at: null,
  gov_status: null,
  gov_id: null,
  gov_error: null,
  gov_checked_at: null,
  error: null,
  error_code: null,
  attempts: 0,
  next_attempt_at: null,
  claim_token: null,
  claimed_at: null,
  lease_until: null,
  issued_at: null,
  cancel_requested_at: null,
  email_status: null,
  emailed_at: null,
  email_error: null,
  deleted_at: null,
}

const FINAL = (kind: string) => kind === "vat" || kind === "receipt"

function applyPatch(row: Row, patch: DocumentPatch): void {
  const values = patch as Record<string, unknown>
  for (const column of PATCHABLE_COLUMNS) if (column in values && values[column] !== undefined) row[column] = values[column]
  row.updated_at = new Date()
}

/** The atomic store over a Table, with the rules of the SQL store and of the two unique indexes. */
export function memoryStore(table: Table): DocumentStore & { inserts: number; ignored: number } {
  const store = {
    inserts: 0,
    ignored: 0,
    async insertIgnore(doc: NewDocument) {
      const clash = table.rows.some(
        (r) => !r.deleted_at && r.order_id === doc.order_id && r.demo === doc.demo && (r.kind === doc.kind || (FINAL(r.kind) && FINAL(doc.kind))),
      )
      if (clash) {
        store.ignored += 1
        return null
      }
      store.inserts += 1
      const now = new Date()
      const row: Row = {
        ...EMPTY_DOCUMENT,
        id: table.nextId(),
        order_id: doc.order_id,
        display_id: doc.display_id,
        kind: doc.kind,
        status: "pending",
        demo: doc.demo,
        next_attempt_at: doc.next_attempt_at,
        pay_requested_at: doc.pay_requested_at ?? null,
        created_at: now,
        updated_at: now,
      }
      table.rows.push(row)
      return { ...row } as never
    },
    async claim(id: string, args: { now: Date; leaseUntil: Date; token: string }) {
      const row = table.rows.find((r) => r.id === id && !r.deleted_at)
      if (!row || row.status !== "pending") return null
      if (row.next_attempt_at && time(row.next_attempt_at) > args.now.getTime()) return null
      Object.assign(row, { status: "issuing", claim_token: args.token, claimed_at: args.now, lease_until: args.leaseUntil, attempts: (row.attempts ?? 0) + 1, updated_at: new Date() })
      return { ...row } as never
    },
    async finish(id: string, token: string, patch: DocumentPatch) {
      const row = table.rows.find((r) => r.id === id && !r.deleted_at)
      if (!row || row.status !== "issuing" || row.claim_token !== token) return false
      applyPatch(row, patch)
      row.claim_token = null
      row.lease_until = null
      return true
    },
    async transition(id: string, from: readonly string[], patch: DocumentPatch) {
      const row = table.rows.find((r) => r.id === id && !r.deleted_at)
      if (!row || !from.includes(row.status)) return null
      applyPatch(row, patch)
      return { ...row } as never
    },
    async expireLeases(now: Date, demo: boolean) {
      let n = 0
      for (const row of table.rows) {
        if (row.status === "issuing" && row.demo === demo && row.lease_until && time(row.lease_until) < now.getTime()) {
          Object.assign(row, { status: "unknown", claim_token: null, lease_until: null, error_code: "lease_expired", error: "lease expired", next_attempt_at: now })
          n += 1
        }
      }
      return n
    },
  }
  return store
}

/* ------------------------------------------------------------------ */
/* The container                                                       */
/* ------------------------------------------------------------------ */

export interface Setup {
  container: { resolve: (key: string, opts?: { allowUnregistered?: boolean }) => any }
  documents: Table
  runs: Table
  store: ReturnType<typeof memoryStore>
  events: Array<{ name: string; data: Row }>
  logs: string[]
  orders: Map<string, Row>
  payments: Map<string, Row>
  collections: Map<string, Row>
}

export function setup(options: FakturowniaPluginOptions, orders: Row[] = []): Setup {
  const o = resolveOptions(options)
  const documents = new Table("fkdoc")
  const runs = new Table("fkrun")
  const store = memoryStore(documents)
  const logs: string[] = []
  const log = (level: string) => (msg: string) => void logs.push(`${level} ${msg}`)
  const svc = {
    getOptions: () => o,
    getLogger: () => ({ info: log("info"), warn: log("warn"), error: log("error"), debug: log("debug") }),
    isDemo: () => o.demo,
    isConfigured: () => (o.demo ? true : Boolean(o.apiToken) && /^[a-z0-9-]+$/.test(o.account)),
    missingOptions: () => [],
    mask: (s: string) => maskSecrets(s, [o.apiToken]),
    listFakturowniaDocuments: async (f: Row, c: Row) => documents.list(f, c),
    listAndCountFakturowniaDocuments: async (f: Row, c: Row) => [documents.list(f, c), documents.list(f).length],
    updateFakturowniaDocuments: async (d: Row) => documents.update(d),
    createFakturowniaSyncRuns: async (d: Row) => {
      const row = { id: runs.nextId(), created_at: new Date(), ...d }
      runs.rows.push(row)
      return { ...row }
    },
    listFakturowniaSyncRuns: async (f: Row, c: Row) => runs.list(f, c),
    deleteFakturowniaSyncRuns: async (ids: string[]) => {
      runs.rows = runs.rows.filter((r) => !ids.includes(r.id))
    },
  }
  const orderMap = new Map(orders.map((x) => [x.id, x]))
  const payments = new Map<string, Row>()
  const collections = new Map<string, Row>()
  const events: Array<{ name: string; data: Row }> = []
  const byIds = (filters: Row | undefined, map: Map<string, Row>) => {
    const id = filters?.id
    if (Array.isArray(id)) return id.map((x) => map.get(x)).filter(Boolean)
    if (typeof id === "string") return map.has(id) ? [map.get(id)] : []
    return [...map.values()]
  }
  const registry: Record<string, unknown> = {
    fakturownia: svc,
    fakturowniaDocumentStore: store,
    query: {
      graph: async ({ entity, filters, pagination }: Row) => {
        if (entity === "order") {
          let data = byIds(filters, orderMap).map((x) => structuredClone(x))
          if (pagination?.order?.created_at === "DESC") data = data.sort((a: Row, b: Row) => time(b.created_at) - time(a.created_at))
          if (pagination?.take) data = data.slice(0, pagination.take)
          return { data }
        }
        if (entity === "payment") return { data: byIds(filters, payments) }
        if (entity === "payment_collection") return { data: byIds(filters, collections) }
        return { data: [] }
      },
    },
    event_bus: { emit: async (e: { name: string; data: Row }) => void events.push(e) },
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
  return { container, documents, runs, store, events, logs, orders: orderMap, payments, collections }
}

/* ------------------------------------------------------------------ */
/* An order                                                            */
/* ------------------------------------------------------------------ */

export function order(overrides: Row = {}): Row {
  return {
    id: "order_01JTEST0000000000000000001",
    display_id: 1042,
    email: "anna@example.com",
    currency_code: "pln",
    created_at: "2026-10-05T09:15:00.000Z",
    status: "pending",
    metadata: {},
    total: 143,
    shipping_total: 20,
    billing_address: {
      first_name: "Anna",
      last_name: "Nowak",
      address_1: "ul. Długa 5",
      address_2: "m. 3",
      postal_code: "00-001",
      city: "Warszawa",
      country_code: "pl",
    },
    shipping_address: { first_name: "Anna", last_name: "Nowak", address_1: "ul. Długa 5", postal_code: "00-001", city: "Warszawa", country_code: "pl" },
    items: [
      {
        id: "ordli_1",
        title: "Krem nawilżający",
        product_title: "Krem nawilżający",
        variant_title: "50 ml",
        variant_sku: "KREM-50",
        detail: { quantity: 2 },
        unit_price: 61.5,
        total: 123,
        tax_lines: [{ rate: 23, code: "PL23" }],
      },
    ],
    shipping_methods: [{ name: "InPost Paczkomat", amount: 20, total: 20, tax_lines: [{ rate: 23, code: "PL23" }] }],
    payment_collections: [{ status: "completed", payments: [{ provider_id: "pp_stripe_stripe", amount: 143, captured_at: "2026-10-05T09:16:00.000Z", captures: [{ amount: 143 }] }] }],
    fulfillments: [],
    ...overrides,
  }
}

/** The same order, not paid yet. */
export function unpaid(overrides: Row = {}): Row {
  return order({ payment_collections: [{ status: "awaiting", payments: [{ provider_id: "pp_system_default", amount: 143, captured_at: null, captures: [] }] }], ...overrides })
}

/* ------------------------------------------------------------------ */
/* A Fakturownia account behind fetch                                  */
/* ------------------------------------------------------------------ */

export type CreateMode = "ok" | "lost_after_commit" | "lost_no_commit" | "http_500_after_commit" | "http_422" | "http_429" | "not_sent"

export interface Call {
  method: string
  url: string
  path: string
  query: URLSearchParams
  authorization: string | null
  body: any
}

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

export class FakeFakturownia {
  docs: Row[] = []
  calls: Call[] = []
  nextId = 600_000_000
  /** One mode per create request, in order; the last one repeats. */
  createModes: CreateMode[] = ["ok"]
  emailMode: "ok" | "ksef_wait" = "ok"
  pdfReady = true
  private creates = 0

  /** A document someone else (or a lost request) already created. */
  add(doc: Row): Row {
    this.nextId += 1
    const full = { id: this.nextId, number: `FV ${this.docs.length + 1}/10/2026`, kind: "vat", paid: "0.0", status: "issued", issue_date: today(), currency: "PLN", gov_status: null, gov_id: null, ...doc }
    this.docs.push(full)
    return full
  }

  creating(): number {
    return this.calls.filter((c) => c.method === "POST" && c.path === "/invoices.json").length
  }

  methods(): string[] {
    return this.calls.map((c) => `${c.method} ${c.path}`)
  }

  private create(invoice: Row): Row {
    const positions = (invoice.positions ?? []) as Row[]
    const gross = positions.reduce((s, p) => s + Number(p.total_price_gross ?? 0), 0)
    const sameKind = this.docs.filter((d) => d.kind === invoice.kind).length
    const doc = this.add({
      ...invoice,
      number: `${invoice.kind === "proforma" ? "PRO" : invoice.kind === "receipt" ? "PAR" : "FV"} ${sameKind + 1}/10/2026`,
      price_gross: gross.toFixed(2),
      paid: invoice.paid ?? "0.0",
      status: invoice.paid && Number(invoice.paid) >= gross ? "paid" : "issued",
      gov_status: invoice.kind === "vat" ? "processing" : "not_applicable",
      positions: positions.map((p, i) => ({ id: 9000 + i, invoice_id: this.nextId + 1, ...p })),
    })
    return doc
  }

  fetch = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    if (url.host !== "mojafirma.fakturownia.pl" || url.protocol !== "https:") throw new Error(`unexpected host ${url.host}`)
    const headers = (init?.headers ?? {}) as Record<string, string>
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : null
    this.calls.push({ method, url: String(input), path: url.pathname, query: url.searchParams, authorization: headers.Authorization ?? null, body })
    if (headers.Authorization !== `Bearer ${TOKEN}`) return reply({ code: "error", message: "nieprawidłowy token" }, 401)
    const path = url.pathname
    const q = url.searchParams

    if (method === "GET" && path === "/invoices.json") {
      let found = this.docs
      if (q.get("oid")) found = found.filter((d) => String(d.oid ?? "") === q.get("oid"))
      if (q.get("kind")) found = found.filter((d) => d.kind === q.get("kind"))
      if (q.get("from_invoice_id")) found = found.filter((d) => String(d.from_invoice_id ?? "") === q.get("from_invoice_id"))
      if (q.get("period") === "more") found = found.filter((d) => (!q.get("date_from") || d.issue_date >= q.get("date_from")!) && (!q.get("date_to") || d.issue_date <= q.get("date_to")!))
      const per = Number(q.get("per_page") ?? 25)
      const page = Number(q.get("page") ?? 1)
      return reply(found.slice((page - 1) * per, page * per))
    }
    if (method === "POST" && path === "/invoices.json") {
      const mode = this.createModes[Math.min(this.creates, this.createModes.length - 1)]
      this.creates += 1
      const invoice = body?.invoice ?? {}
      if (mode === "not_sent") throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })
      if (mode === "http_422") return reply({ code: "error", message: { buyer_tax_no: ["- nieprawidłowy numer NIP"] } }, 422)
      if (mode === "http_429") return reply({ code: "error", message: "too many requests" }, 429)
      if (invoice.oid_unique === "yes" && this.docs.some((d) => d.oid === invoice.oid)) return reply({ code: "error", message: { oid: ["jest już zajęty"] } }, 422)
      if (mode === "lost_no_commit") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })
      const doc = this.create(invoice)
      if (mode === "lost_after_commit") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })
      if (mode === "http_500_after_commit") return new Response("<html>502 Bad Gateway</html>", { status: 502 })
      return reply(doc, 201)
    }
    const one = /^\/invoices\/(\d+)(\.json|\.pdf|\/change_status\.json|\/send_by_email\.json)$/.exec(path)
    if (one) {
      const doc = this.docs.find((d) => String(d.id) === one[1])
      if (!doc) return reply({ code: "error", message: "not found" }, 404)
      if (method === "GET" && one[2] === ".json") return reply(doc)
      if (method === "GET" && one[2] === ".pdf") {
        if (!this.pdfReady) return new Response("<html>KSeF</html>", { status: 200, headers: { "Content-Type": "text/html" } })
        return new Response(new TextEncoder().encode("%PDF-1.4 fake"), { status: 200, headers: { "Content-Type": "application/pdf" } })
      }
      if (method === "PUT" && one[2] === ".json") {
        Object.assign(doc, body?.invoice ?? {})
        if (Number(doc.paid) >= Number(doc.price_gross)) doc.status = "paid"
        return reply(doc)
      }
      if (method === "POST" && one[2] === "/change_status.json") {
        doc.status = q.get("status")
        return reply({ status: "ok" })
      }
      if (method === "POST" && one[2] === "/send_by_email.json") {
        if (this.emailMode === "ksef_wait") return reply({ message: "Faktura nie może zostać wysłana - brak numeru KSeF", status: "error" })
        doc.status = doc.status === "issued" ? "sent" : doc.status
        return reply({ status: "ok" })
      }
    }
    if (method === "GET" && path === "/departments.json") return reply([{ id: 101, name: "Moja Firma sp. z o.o.", shortcut: "MF" }])
    if (method === "GET" && path === "/categories.json") return reply([{ id: 7, name: "Sklep internetowy" }])
    return reply({ code: "error", message: "unknown route" }, 404)
  }) as typeof fetch
}

/** Waits until background passes (kicks) of this process are done. */
export async function settle(running: () => string[], ms = 3000): Promise<void> {
  const until = Date.now() + ms
  await new Promise((r) => setTimeout(r, 20))
  while (running().length > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
}
