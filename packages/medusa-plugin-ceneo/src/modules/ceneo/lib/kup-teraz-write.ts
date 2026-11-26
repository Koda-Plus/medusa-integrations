/**
 * KUP TERAZ WRITES TO CENEO: the transport the status writer talks to.
 * Pure, zero runtime imports. The live one goes through `CeneoClient.write`
 * (the barrier: a write path, an armed writer); the demo one sends nothing
 * and keeps the last 200 writes in memory, per process (for tests and a
 * debugger; the order rows show what was sent).
 *
 * PARAMETERS. The Swagger types `id`, `orderId`, `trackingNumber`, `reason`
 * and `orders` as strings and `carrierId` as an integer. OData v2 service
 * operations take a string in single quotes, so strings go through
 * `quote`. Not confirmed on a live account yet (PLAN, section 4).
 */

import { odataList } from "./odata"
import type { CeneoDictEntry } from "./kup-teraz"
import type { NextWrite } from "./order-input"

export interface CeneoCarrier {
  id: number
  name: string
}

export interface CeneoCancelReason {
  id: number
  reason: string
  requiresText: boolean
}

export interface CeneoWriteTransport {
  readonly demo: boolean
  run(ceneoOrderId: string, write: NextWrite): Promise<void>
  carriers(): Promise<CeneoCarrier[]>
  cancelReasons(): Promise<CeneoCancelReason[]>
}

type WriteClient = {
  write(path: string, query: Record<string, string>, writer: string): Promise<unknown>
  get(path: string, query?: Record<string, string>): Promise<unknown>
}

/** One write as the path and query Ceneo gets. */
export function writeRequest(ceneoOrderId: string, w: NextWrite, quote: (v: string) => string): { path: string; query: Record<string, string> } {
  const id = quote(ceneoOrderId)
  switch (w.kind) {
    case "shop_order_id":
      return { path: "/BasketService.svc/SetOrders", query: { orders: quote(JSON.stringify([{ OrderId: ceneoOrderId, ShopOrderId: w.shopOrderId }])) } }
    case "confirm":
      return { path: "/BasketService.svc/ConfirmOrder", query: { id } }
    case "shipment":
      return { path: "/BasketService.svc/SetOrderShipment", query: { orderId: id, trackingNumber: quote(w.tracking), carrierId: String(w.carrierId) } }
    case "send":
      return { path: "/BasketService.svc/SendOrder", query: { id } }
    case "cancel":
      return { path: "/BasketService.svc/CancelOrder", query: { id, reason: quote(w.reason) } }
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null)

export function toCarriers(body: unknown): CeneoCarrier[] {
  return odataList(body)
    .map((r) => ({ id: num(r.Id), name: typeof r.Name === "string" ? r.Name : "" }))
    .filter((c): c is CeneoCarrier => c.id !== null)
    .sort((a, b) => a.id - b.id)
}

export function toCancelReasons(body: unknown): CeneoCancelReason[] {
  return odataList(body)
    .map((r) => ({ id: num(r.Id), reason: typeof r.Reason === "string" ? r.Reason : "", requiresText: r.RequiresDetailedText === true }))
    .filter((c): c is CeneoCancelReason => c.id !== null)
    .sort((a, b) => a.id - b.id)
}

export function liveWriteTransport(client: WriteClient, quote: (v: string) => string): CeneoWriteTransport {
  return {
    demo: false,
    async run(ceneoOrderId, w) {
      const { path, query } = writeRequest(ceneoOrderId, w, quote)
      await client.write(path, query, "status")
    },
    async carriers() {
      return toCarriers(await client.get("/BasketService.svc/ParcelCarriers"))
    },
    async cancelReasons() {
      return toCancelReasons(await client.get("/BasketService.svc/OrderCancellationReasons"))
    },
  }
}

/* ---- the simulated account ---------------------------------------------- */

export interface DemoWriteLog {
  at: string
  ceneoOrderId: string
  write: NextWrite
}

const LOG = Symbol.for("koda.ceneo.demo.writes")

export function demoWriteLog(): DemoWriteLog[] {
  const h = globalThis as typeof globalThis & { [LOG]?: DemoWriteLog[] }
  if (!h[LOG]) h[LOG] = []
  return h[LOG]
}

export const DEMO_CARRIERS: CeneoCarrier[] = [
  { id: 1, name: "Kurier (demo)" },
  { id: 2, name: "Paczkomat (demo)" },
]

export const DEMO_CANCEL_REASONS: CeneoCancelReason[] = [
  { id: 1, reason: "Towar niedostępny", requiresText: false },
  { id: 2, reason: "Przedmiot został uszkodzony przed wysyłką", requiresText: false },
]

export function demoWriteTransport(now: () => number = () => Date.now()): CeneoWriteTransport {
  return {
    demo: true,
    async run(ceneoOrderId, write) {
      const log = demoWriteLog()
      log.push({ at: new Date(now()).toISOString(), ceneoOrderId, write })
      if (log.length > 200) log.splice(0, log.length - 200)
    },
    async carriers() {
      return DEMO_CARRIERS
    },
    async cancelReasons() {
      return DEMO_CANCEL_REASONS
    },
  }
}

/** The state names for the admin, with the carriers' names. */
export function dictNames(entries: readonly CeneoDictEntry[]): Map<number, string> {
  return new Map(entries.map((e) => [e.id, e.description || e.value]))
}
