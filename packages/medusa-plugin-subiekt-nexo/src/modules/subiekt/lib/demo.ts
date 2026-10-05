/**
 * THE DEMO BRIDGE. Answers every contract call without a network or a
 * Subiekt installation, so the whole flow can be evaluated in any Medusa
 * store: orders get ZK numbers, about three minutes later the "warehouse"
 * issues a WZ that arrives through the event feed, stock and products with
 * prices come from the catalog's own SKUs, sales documents get FS and PA
 * numbers and an FS gets its KSeF number two minutes later.
 *
 * It behaves like a real bridge where it matters for evaluation: idempotent
 * ZK per order, `unmatched_lines` for lines without EAN and SKU,
 * `document_locked` when canceling an order that already has a WZ or a sales
 * document, an honest `manual_action_required` on cancel, one sales document
 * per order, contractors found or created by NIP, a duplicated EAN in the
 * product list, and a clock 1.4 seconds ahead of Medusa (a skew the admin
 * shows as fine).
 *
 * STATE LIVES IN THE PLUGIN'S OWN TABLE (`subiekt_document`, `demo = true`).
 * Event ids are derived from document times, so a restart loses nothing.
 */

import type {
  BridgeEvent,
  BridgeHealth,
  BuyerResult,
  CancelResult,
  ContractDocument,
  ContractOrder,
  EventsPage,
  FulfillmentRequest,
  FulfillmentResult,
  OrderResult,
  OrderStatusResult,
  PriceLevel,
  ProductItem,
  ProductsPage,
  SalesDocumentRequest,
  SalesDocumentResult,
  StockItem,
  StockPage,
} from "./contract"
import type { BridgeApi } from "./bridge-client"
import { BridgeError } from "./bridge-client"
import type { DocumentRow } from "./dto"
import { CONTRACT_VERSION, DEMO_WZ_AFTER_MS } from "./constants"
import { normalizeEan } from "./order-payload"
import { formatNip } from "./nip"
import { round } from "./numbers"

export interface DemoStore {
  /** Demo documents, optionally of one order. */
  listDemoDocuments(orderId?: string): Promise<DocumentRow[]>
  countDemoDocuments(kind: string): Promise<number>
}

export interface DemoCatalogItem {
  sku: string | null
  ean: string | null
  title: string | null
  /** Since 0.2.0: the variant's PLN price in Medusa, when it has one. */
  price?: number | null
  /** Since 0.2.0: the variant's weight in Medusa (grams by convention). */
  weight?: number | null
}

export const DEMO_WAREHOUSE = "MAG"
/** The demo company that "sells": its NIP starts every demo KSeF number. */
export const DEMO_COMPANY_NIP = "5265877635"
/** An FS gets its KSeF number this long after it was issued. */
export const DEMO_KSEF_AFTER_MS = 2 * 60 * 1000
/** The demo bridge clock runs this far ahead of Medusa: a skew the admin shows as fine. */
export const DEMO_CLOCK_SKEW_MS = 1400

const ZK_START = 101
const WZ_OFFSET = 200
const FS_START = 41
const PA_START = 301

export const DEMO_PRICE_LEVELS: readonly PriceLevel[] = [
  { symbol: "DETAL", name: "Detaliczna", currency: "PLN" },
  { symbol: "HURT", name: "Hurtowa", currency: "PLN" },
]

/** FNV-1a, 32 bit. Stable across processes, so demo stock does not jump on restart. */
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Sequence number of a document signature, `ZK 123/MAG/2026` gives 123. */
export function sequenceOf(number: string): number {
  const m = /^[A-Z]+\s+(\d+)\//i.exec(number.trim())
  return m ? Number(m[1]) : 0
}

function yearOf(value: Date | string | null | undefined, fallback: Date): number {
  const d = value instanceof Date ? value : value ? new Date(value) : fallback
  return Number.isNaN(d.getTime()) ? fallback.getUTCFullYear() : d.getUTCFullYear()
}

function timeOf(value: Date | string | null | undefined): number {
  if (!value) return Date.now()
  const t = (value instanceof Date ? value : new Date(value)).getTime()
  return Number.isNaN(t) ? Date.now() : t
}

function toDocument(row: DocumentRow): ContractDocument {
  const issued = row.issued_at instanceof Date ? row.issued_at.toISOString() : row.issued_at ?? new Date().toISOString()
  return {
    kind: row.kind,
    number: row.number,
    id: row.subiekt_id,
    issued_at: issued,
    status: (row.status as ContractDocument["status"]) ?? "open",
    warehouse: row.warehouse,
    ksef_number: row.ksef_number ?? null,
    related: row.related ?? [],
  }
}

/** The WZ a demo ZK gets, deterministic so the event feed and a Medusa fulfillment agree. */
export function demoWzFor(zk: DocumentRow): { number: string; issuedAtMs: number; eventId: number } {
  const seq = sequenceOf(zk.number)
  const zkTime = zk.issued_at ? new Date(zk.issued_at).getTime() : Date.now()
  const issuedAtMs = zkTime + DEMO_WZ_AFTER_MS
  return {
    number: `WZ ${seq + WZ_OFFSET}/${DEMO_WAREHOUSE}/${yearOf(zk.issued_at, new Date())}`,
    issuedAtMs,
    eventId: issuedAtMs * 1000 + (seq % 1000),
  }
}

/** The KSeF number a demo FS gets, in the shape KSeF uses: seller NIP, date, 12 characters, 2 control characters. */
export function demoKsefFor(fs: Pick<DocumentRow, "number" | "issued_at">): { ksef: string; atMs: number; eventId: number } {
  const issued = timeOf(fs.issued_at)
  const atMs = issued + DEMO_KSEF_AFTER_MS
  const h1 = hash32(`ksef:${fs.number}`).toString(16).toUpperCase().padStart(8, "0")
  const h2 = hash32(`ksef2:${fs.number}`).toString(16).toUpperCase().padStart(8, "0")
  const date = new Date(issued).toISOString().slice(0, 10).replace(/-/g, "")
  return {
    ksef: `${DEMO_COMPANY_NIP}-${date}-${(h1 + h2).slice(0, 12)}-${h2.slice(-2)}`,
    atMs,
    eventId: atMs * 1000 + 500 + (sequenceOf(fs.number) % 500),
  }
}

/** Demo stock of one SKU: stable per SKU, drifting slowly every 20 minutes, some at zero. */
export function demoQuantity(sku: string, now: Date): { quantity: number; available: number } {
  const h = hash32(sku.toUpperCase())
  if (h % 7 === 0) return { quantity: 0, available: 0 }
  const slot = Math.floor(now.getTime() / (20 * 60 * 1000))
  const base = 6 + (h % 55)
  const drift = ((h >>> 3) + slot) % 4
  const quantity = Math.max(0, base - drift)
  const reserved = h % 3 === 0 ? Math.min(2, quantity) : 0
  return { quantity, available: quantity - reserved }
}

/**
 * The retail price Subiekt "has" for a SKU: most often what Medusa already
 * asks (unchanged), sometimes 5 % more, sometimes 10 % less, so the price plan
 * shows changes both ways. Without a Medusa price, a stable price from the SKU.
 */
export function demoRetailPrice(sku: string, medusaPrice: number | null | undefined): number {
  const h = hash32(`price:${sku.toUpperCase()}`)
  const base = typeof medusaPrice === "number" && Number.isFinite(medusaPrice) && medusaPrice > 0 ? medusaPrice : 19.99 + (h % 180)
  const bucket = h % 10
  if (bucket <= 6) return round(base, 2)
  if (bucket <= 8) return round(Math.floor(base * 1.05) + 0.99, 2)
  return round(Math.max(1, Math.floor(base * 0.9)) + 0.9, 2)
}

function prices(retailGross: number, vat: number): ProductItem["prices"] {
  const wholesaleGross = round(retailGross * 0.8, 2)
  const factor = 1 + vat / 100
  return [
    { level: "DETAL", net: round(retailGross / factor, 2), gross: retailGross, currency: "PLN" },
    { level: "HURT", net: round(wholesaleGross / factor, 2), gross: wholesaleGross, currency: "PLN" },
  ]
}

/** EAN-13 with a valid check digit, stable per text. For demo products that need one. */
export function demoEan(seed: string): string {
  const body = `590${String(hash32(seed) % 1_000_000_000).padStart(9, "0")}`
  const sum = body.split("").reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/** The contractor a demo NIP "has" in Subiekt: about a third of the NIPs exist. */
function demoContractor(nip: string): { exists: boolean; symbol: string } {
  return { exists: hash32(`nip:${nip}`) % 3 === 0, symbol: `K${String(hash32(nip) % 1000).padStart(3, "0")}` }
}

export class DemoBridge implements BridgeApi {
  readonly mode = "demo" as const
  private readonly store: DemoStore
  private readonly catalog: () => Promise<DemoCatalogItem[]>
  private readonly now: () => Date

  constructor(store: DemoStore, catalog: () => Promise<DemoCatalogItem[]>, now: () => Date = () => new Date()) {
    this.store = store
    this.catalog = catalog
    this.now = now
  }

  async health(): Promise<BridgeHealth> {
    const now = this.now()
    const t = new Date(now.getTime() + DEMO_CLOCK_SKEW_MS).toISOString()
    const started = new Date(now)
    started.setUTCHours(5, 0, 0, 0)
    const docs = await this.store.listDemoDocuments()
    const last = docs.reduce<number>((max, d) => Math.max(max, timeOf(d.issued_at)), 0)
    return {
      status: "ok",
      capabilities: ["orders", "fulfillments", "stock", "events", "products", "contractors", "contractors.create", "documents.fs", "documents.pa", "documents.ksef", "webhook"],
      bridge: {
        name: "Subiekt nexo bridge by Koda Plus (demo)",
        version: "0.2.0",
        contract: CONTRACT_VERSION,
        mode: "fake",
        sdk_version: "61.0.1.9371",
        started_at: started.toISOString(),
      },
      subiekt: {
        connected: true,
        product: "Subiekt nexo PRO",
        version: "61.0.1.9371",
        database: "Demo",
        database_version: "61.0.1.9371",
        licence: "ok",
        company: "Sklep Demo",
        warehouse: DEMO_WAREHOUSE,
        checked_at: t,
        error: null,
      },
      events: { last_id: docs.length, last_at: last > 0 ? new Date(last).toISOString() : null },
      queues: { sfera_pending: 0, webhook_pending: 0 },
      time: t,
    }
  }

  private buyerOf(order: ContractOrder): { buyer: BuyerResult; warnings: string[] } {
    const b = order.buyer
    if (!b?.nip) return { buyer: { source: "retail", nip: null, symbol: "DETAL", name: "Klient detaliczny" }, warnings: [] }
    const c = demoContractor(b.nip)
    if (c.exists) return { buyer: { source: "existing", nip: b.nip, symbol: c.symbol, name: b.company_name ?? `Firma ${formatNip(b.nip)}` }, warnings: [] }
    if (b.create_if_missing) return { buyer: { source: "created", nip: b.nip, symbol: c.symbol, name: b.company_name ?? `Firma ${formatNip(b.nip)}` }, warnings: [] }
    return {
      buyer: { source: "retail", nip: null, symbol: "DETAL", name: "Klient detaliczny" },
      warnings: [`No contractor with NIP ${formatNip(b.nip)} in Subiekt, so the ZK went to the retail buyer.`],
    }
  }

  async createOrder(order: ContractOrder): Promise<OrderResult> {
    const existing = (await this.store.listDemoDocuments(order.order_id)).find((d) => d.kind === "ZK")
    if (existing) return { order_id: order.order_id, created: false, document: toDocument(existing), warnings: [] }

    const unmatched = order.lines.filter((l) => !l.sku && !l.ean)
    if (unmatched.length > 0) {
      throw new BridgeError({
        code: "unmatched_lines",
        message: `${unmatched.length} of ${order.lines.length} lines have no EAN and no SKU, so Subiekt cannot find the product.`,
        status: 422,
        retryable: false,
        details: { lines: unmatched.map((l) => ({ line_id: l.line_id, sku: l.sku, ean: l.ean, title: l.title })) },
      })
    }

    const now = this.now()
    const seq = ZK_START + (await this.store.countDemoDocuments("ZK"))
    const { buyer, warnings } = this.buyerOf(order)
    return {
      order_id: order.order_id,
      created: true,
      document: {
        kind: "ZK",
        number: `ZK ${seq}/${DEMO_WAREHOUSE}/${now.getUTCFullYear()}`,
        id: `demo-${seq}`,
        issued_at: now.toISOString(),
        status: "open",
        warehouse: DEMO_WAREHOUSE,
        related: [],
      },
      buyer,
      warnings,
    }
  }

  async getOrder(orderId: string): Promise<OrderStatusResult | null> {
    const docs = await this.store.listDemoDocuments(orderId)
    return docs.length > 0 ? { order_id: orderId, documents: docs.map(toDocument) } : null
  }

  async cancelOrder(orderId: string): Promise<CancelResult> {
    const docs = await this.store.listDemoDocuments(orderId)
    const wz = docs.find((d) => d.kind === "WZ")
    if (wz) {
      throw new BridgeError({
        code: "document_locked",
        message: `${wz.number} already released the goods. Handle the cancellation as a return in Subiekt.`,
        status: 409,
        retryable: false,
      })
    }
    const sales = docs.find((d) => (d.kind === "FS" || d.kind === "PA") && d.status !== "canceled")
    if (sales) {
      throw new BridgeError({
        code: "document_locked",
        message: `${sales.number} was already issued for this order. Handle the cancellation with a correction in Subiekt.`,
        status: 409,
        retryable: false,
      })
    }
    const zk = docs.find((d) => d.kind === "ZK")
    if (!zk) return { order_id: orderId, status: "not_found", manual_action_required: false, message: null, documents: [] }
    if (zk.status === "canceled") {
      return { order_id: orderId, status: "already_canceled", manual_action_required: false, message: null, documents: [toDocument(zk)] }
    }
    return {
      order_id: orderId,
      status: "canceled",
      manual_action_required: true,
      message: `${zk.number} is marked as canceled in its notes. Set the status to "Unieważnione" in Subiekt by hand.`,
      documents: [{ ...toDocument(zk), status: "canceled" }],
    }
  }

  async createFulfillment(orderId: string, _request: FulfillmentRequest): Promise<FulfillmentResult> {
    const docs = await this.store.listDemoDocuments(orderId)
    const existing = docs.find((d) => d.kind === "WZ")
    if (existing) return { order_id: orderId, created: false, document: toDocument(existing) }
    const zk = docs.find((d) => d.kind === "ZK" && d.status !== "canceled")
    if (!zk) {
      throw new BridgeError({ code: "order_not_found", message: "This order has no ZK in Subiekt yet.", status: 404, retryable: true })
    }
    const wz = demoWzFor(zk)
    return {
      order_id: orderId,
      created: true,
      document: {
        kind: "WZ",
        number: wz.number,
        id: `demo-wz-${sequenceOf(zk.number)}`,
        issued_at: this.now().toISOString(),
        status: "open",
        warehouse: DEMO_WAREHOUSE,
        related: [{ kind: "ZK", number: zk.number }],
      },
    }
  }

  async issueDocument(orderId: string, request: SalesDocumentRequest): Promise<SalesDocumentResult> {
    const kind = request.kind === "pa" ? "PA" : "FS"
    const docs = await this.store.listDemoDocuments(orderId)
    const existing = docs.find((d) => (d.kind === "FS" || d.kind === "PA") && d.status !== "canceled")
    if (existing) {
      return {
        order_id: orderId,
        created: false,
        document: toDocument(existing),
        warnings: existing.kind === kind ? [] : [`The order already has ${existing.number}; a ${kind} was not created.`],
      }
    }
    const zk = docs.find((d) => d.kind === "ZK" && d.status !== "canceled")
    if (!zk) {
      throw new BridgeError({ code: "order_not_found", message: "This order has no open ZK in Subiekt yet.", status: 404, retryable: true })
    }
    const wzs = docs.filter((d) => d.kind === "WZ" && d.status !== "canceled")
    const now = this.now()
    const seq = (kind === "FS" ? FS_START : PA_START) + (await this.store.countDemoDocuments(kind))
    return {
      order_id: orderId,
      created: true,
      document: {
        kind,
        number: `${kind} ${seq}/${DEMO_WAREHOUSE}/${now.getUTCFullYear()}`,
        id: `demo-${kind.toLowerCase()}-${seq}`,
        issued_at: now.toISOString(),
        status: "open",
        warehouse: DEMO_WAREHOUSE,
        ksef_number: null,
        related: wzs.length > 0 ? wzs.map((w) => ({ kind: "WZ", number: w.number })) : [{ kind: "ZK", number: zk.number }],
      },
      warnings: [],
    }
  }

  async listStock(cursor: string | null, limit: number): Promise<StockPage> {
    const now = this.now()
    const items: StockItem[] = []
    for (const c of await this.catalog()) {
      const sku = c.sku?.trim()
      if (!sku) continue
      // Every ninth product is missing in Subiekt, to show unmatched variants in the admin.
      if (hash32(`missing:${sku.toUpperCase()}`) % 9 === 0) continue
      items.push({ symbol: sku, ean: normalizeEan(c.ean), name: c.title, ...demoQuantity(sku, now), unit: "szt." })
    }
    for (let i = 1; i <= 3; i++) {
      items.push({ symbol: `SUBIEKT-ONLY-0${i}`, ean: null, name: `Produkt tylko w Subiekcie ${i}`, ...demoQuantity(`only-${i}`, now), unit: "szt." })
    }
    items.sort((a, b) => a.symbol.localeCompare(b.symbol))

    const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0
    const page = items.slice(offset, offset + limit)
    const next = offset + limit < items.length ? String(offset + limit) : null
    return { snapshot_at: now.toISOString(), warehouses: [DEMO_WAREHOUSE], items: page, next_cursor: next, total: items.length }
  }

  /**
   * Products of the store's own catalog with two price levels, the same SKUs
   * missing as in the stock, three Subiekt-only products (two meant for the
   * online shop, one not), a kit, and two products sharing one EAN.
   */
  async listProducts(cursor: string | null, limit: number): Promise<ProductsPage> {
    const now = this.now()
    const items: ProductItem[] = []
    let sharedEan: string | null = null
    for (const c of await this.catalog()) {
      const sku = c.sku?.trim()
      if (!sku) continue
      if (hash32(`missing:${sku.toUpperCase()}`) % 9 === 0) continue
      const ean = normalizeEan(c.ean)
      const h = hash32(`vat:${sku.toUpperCase()}`)
      const vat = h % 6 === 0 ? 8 : 23
      const weight = typeof c.weight === "number" && c.weight > 0 ? round(c.weight / 1000, 3) : round(0.05 + (h % 140) / 100, 2)
      if (!sharedEan && ean) sharedEan = ean
      items.push({
        symbol: sku,
        name: c.title,
        ean,
        unit: "szt.",
        vat_rate: vat,
        vat_symbol: String(vat),
        kind: "goods",
        active: true,
        weight_kg: weight,
        prices: prices(demoRetailPrice(sku, c.price), vat),
      })
    }
    const extra: Array<Omit<ProductItem, "prices"> & { retail: number }> = [
      { symbol: "SUBIEKT-ONLY-01", name: "Zestaw próbek kosmetyków", ean: demoEan("only-1"), unit: "szt.", vat_rate: 23, vat_symbol: "23", kind: "goods", active: true, weight_kg: 0.2, retail: 49.9 },
      { symbol: "SUBIEKT-ONLY-02", name: "Kosmetyczka podróżna", ean: demoEan("only-2"), unit: "szt.", vat_rate: 23, vat_symbol: "23", kind: "goods", active: true, weight_kg: 0.15, retail: 39.99 },
      { symbol: "SUBIEKT-ONLY-03", name: "Opakowanie zbiorcze (tylko magazyn)", ean: null, unit: "szt.", vat_rate: 23, vat_symbol: "23", kind: "goods", active: false, weight_kg: 0.5, retail: 5 },
      { symbol: "ZESTAW-PREZENTOWY", name: "Zestaw prezentowy", ean: demoEan("kit"), unit: "kpl.", vat_rate: 23, vat_symbol: "23", kind: "kit", active: true, weight_kg: 0.6, retail: 159 },
      // One EAN on two Subiekt products: a conflict the plan reports and never guesses.
      { symbol: "DUPLIKAT-EAN-A", name: "Krem z błędnym kodem kreskowym", ean: sharedEan ?? demoEan("dup"), unit: "szt.", vat_rate: 23, vat_symbol: "23", kind: "goods", active: true, weight_kg: 0.1, retail: 59 },
    ]
    if (!sharedEan) {
      // A catalog without EANs: the second product of the pair comes from Subiekt too.
      extra.push({ symbol: "DUPLIKAT-EAN-B", name: "Krem z tym samym kodem", ean: demoEan("dup"), unit: "szt.", vat_rate: 23, vat_symbol: "23", kind: "goods", active: true, weight_kg: 0.1, retail: 61 })
    }
    for (const e of extra) {
      const { retail, ...rest } = e
      items.push({ ...rest, prices: prices(retail, e.vat_rate ?? 23) })
    }
    items.sort((a, b) => a.symbol.localeCompare(b.symbol))

    const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0
    const page = items.slice(offset, offset + limit)
    const next = offset + limit < items.length ? String(offset + limit) : null
    return { snapshot_at: now.toISOString(), price_levels: [...DEMO_PRICE_LEVELS], items: page, next_cursor: next, total: items.length }
  }

  async listEvents(after: number, limit: number): Promise<EventsPage> {
    const now = this.now().getTime()
    const docs = await this.store.listDemoDocuments()
    const ordersWithWz = new Set(docs.filter((d) => d.kind === "WZ" && d.order_id).map((d) => d.order_id))

    const events: BridgeEvent[] = []
    for (const zk of docs) {
      if (zk.kind !== "ZK" || zk.status === "canceled" || !zk.order_id || ordersWithWz.has(zk.order_id)) continue
      const wz = demoWzFor(zk)
      if (wz.issuedAtMs > now || wz.eventId <= after) continue
      events.push({
        id: wz.eventId,
        type: "document.issued",
        occurred_at: new Date(wz.issuedAtMs).toISOString(),
        data: {
          order_id: zk.order_id,
          source: "subiekt",
          document: {
            kind: "WZ",
            number: wz.number,
            id: `demo-wz-${sequenceOf(zk.number)}`,
            issued_at: new Date(wz.issuedAtMs).toISOString(),
            status: "open",
            warehouse: DEMO_WAREHOUSE,
            related: [{ kind: "ZK", number: zk.number }],
          },
        },
      })
    }
    // KSeF assigns the number of a demo FS two minutes after it was issued.
    for (const fs of docs) {
      if (fs.kind !== "FS" || fs.ksef_number || !fs.order_id) continue
      const k = demoKsefFor(fs)
      if (k.atMs > now || k.eventId <= after) continue
      events.push({
        id: k.eventId,
        type: "document.updated",
        occurred_at: new Date(k.atMs).toISOString(),
        data: { order_id: fs.order_id, source: "subiekt", document: { ...toDocument(fs), ksef_number: k.ksef } },
      })
    }
    events.sort((a, b) => a.id - b.id)
    const page = events.slice(0, limit)
    return { events: page, last_id: page.length > 0 ? page[page.length - 1].id : after, has_more: events.length > limit }
  }
}
