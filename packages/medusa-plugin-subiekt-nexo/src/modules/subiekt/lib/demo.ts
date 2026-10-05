/**
 * THE DEMO BRIDGE. Answers every contract call without a network or a
 * Subiekt installation, so the whole flow can be evaluated in any Medusa
 * store: orders get ZK numbers, about three minutes later the "warehouse"
 * issues a WZ that arrives through the event feed, stock comes from the
 * catalog's own SKUs.
 *
 * It behaves like a real bridge where it matters for evaluation: idempotent
 * ZK per order, `unmatched_lines` for lines without EAN and SKU,
 * `document_locked` when canceling an order that already has a WZ, and an
 * honest `manual_action_required` on cancel, as Sfera cannot set every ZK
 * status by itself.
 *
 * STATE LIVES IN THE PLUGIN'S OWN TABLE (`subiekt_document`, `demo = true`).
 * Event ids are derived from document times, so a restart loses nothing.
 */

import type {
  BridgeEvent,
  BridgeHealth,
  CancelResult,
  ContractDocument,
  ContractOrder,
  EventsPage,
  FulfillmentRequest,
  FulfillmentResult,
  OrderResult,
  OrderStatusResult,
  StockItem,
  StockPage,
} from "./contract"
import type { BridgeApi } from "./bridge-client"
import { BridgeError } from "./bridge-client"
import type { DocumentRow } from "./dto"
import { CONTRACT_VERSION, DEMO_WZ_AFTER_MS } from "./constants"
import { normalizeEan } from "./order-payload"

export interface DemoStore {
  /** Demo documents, optionally of one order. */
  listDemoDocuments(orderId?: string): Promise<DocumentRow[]>
  countDemoDocuments(kind: string): Promise<number>
}

export interface DemoCatalogItem {
  sku: string | null
  ean: string | null
  title: string | null
}

export const DEMO_WAREHOUSE = "MAG"
const ZK_START = 101
const WZ_OFFSET = 200

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

function toDocument(row: DocumentRow): ContractDocument {
  const issued = row.issued_at instanceof Date ? row.issued_at.toISOString() : row.issued_at ?? new Date().toISOString()
  return {
    kind: row.kind,
    number: row.number,
    id: row.subiekt_id,
    issued_at: issued,
    status: (row.status as ContractDocument["status"]) ?? "open",
    warehouse: row.warehouse,
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
    const t = this.now().toISOString()
    return {
      status: "ok",
      bridge: { name: "Subiekt nexo bridge by Koda Plus (demo)", version: "0.1.0", contract: CONTRACT_VERSION, mode: "fake" },
      subiekt: {
        connected: true,
        product: "Subiekt nexo PRO",
        version: "61.0.1.9371",
        database: "Demo",
        company: "Sklep Demo",
        warehouse: DEMO_WAREHOUSE,
        checked_at: t,
        error: null,
      },
      time: t,
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
      warnings: [],
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
    events.sort((a, b) => a.id - b.id)
    const page = events.slice(0, limit)
    return { events: page, last_id: page.length > 0 ? page[page.length - 1].id : after, has_more: events.length > limit }
  }
}
