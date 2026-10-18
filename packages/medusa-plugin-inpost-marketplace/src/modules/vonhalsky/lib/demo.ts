/**
 * DEMO MODE: the simulated marketplace. Nothing here calls fetch or any
 * outside address. The demo client answers like a seller account would
 * (offers published at once, tracking accepted), keeps a short log of what
 * it was asked, and `demoOrder` builds a sample marketplace order from the
 * offers the store listed, with a sample buyer (an example.com address, a
 * sample street and a sample parcel locker).
 */

import { createHash } from "node:crypto"
import type { MarketplaceClient, MarketplaceOrder, OfferPayload, OfferResult } from "./client"

export interface DemoCall {
  at: string
  call: string
  detail?: string
}

export interface DemoClient extends MarketplaceClient {
  readonly log: DemoCall[]
  /** Keeps a simulated order, so `getOrder` (a retry) finds it. In memory: a restart forgets it. */
  remember(order: MarketplaceOrder): void
}

/** The offer id the simulated marketplace gives a variant: stable, so a second listing finds the same offer. */
export function demoOfferId(externalId: string): string {
  return `demo-${createHash("sha256").update(externalId).digest("hex").slice(0, 12)}`
}

export function createDemoClient(): DemoClient {
  const log: DemoCall[] = []
  const orders = new Map<string, MarketplaceOrder>()
  const note = (call: string, detail?: string) => {
    log.push({ at: new Date().toISOString(), call, ...(detail ? { detail } : {}) })
    if (log.length > 200) log.splice(0, log.length - 200)
  }
  return {
    mode: "demo",
    available: true,
    log,
    remember(order: MarketplaceOrder) {
      orders.set(order.id, order)
      if (orders.size > 100) orders.delete(orders.keys().next().value as string)
    },
    async getOrder(orderId: string) {
      note("get_order", orderId)
      return orders.get(orderId) ?? null
    },
    async check() {
      note("check")
      return { ok: true as const }
    },
    async upsertOffers(offers: OfferPayload[]): Promise<OfferResult[]> {
      note("upsert_offers", String(offers.length))
      return offers.map((o) => ({ externalId: o.externalId, remoteId: demoOfferId(o.externalId), remoteStatus: o.quantity > 0 ? "PUBLISHED" : "SOLDOUT" }))
    },
    async closeOffer(remoteId: string) {
      note("close_offer", remoteId)
    },
    async listNewOrders() {
      note("list_orders")
      /* The simulated marketplace has no buyers of its own: orders come from "Simulate an order". */
      return { orders: [], cursor: null }
    },
    async acceptOrder(orderId: string) {
      note("accept_order", orderId)
    },
    async sendTracking(orderId: string, trackingNumbers: string[]) {
      note("send_tracking", `${orderId}: ${trackingNumbers.join(", ")}`)
    },
  }
}

export interface DemoOfferPick {
  remoteId: string
  variantId: string
  sku: string | null
  ean: string | null
  title: string
  priceMinor: number
  stock: number
}

const LOCKERS = ["DEMO01M", "DEMO02A", "DEMO03P"]

/**
 * A sample marketplace order from listed offers: one or two lines (offers
 * with stock first), quantity 1, a parcel locker or a courier in turn, the
 * marketplace's own payment (paid) or, every fourth order, cash on delivery.
 */
export function demoOrder(id: string, offers: readonly DemoOfferPick[], n: number, now: Date = new Date()): MarketplaceOrder | null {
  const pool = [...offers].filter((o) => o.priceMinor > 0).sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.variantId.localeCompare(b.variantId))
  if (pool.length === 0) return null
  const inStock = pool.filter((o) => o.stock > 0)
  const source = inStock.length > 0 ? inStock : pool
  const first = source[n % source.length]
  const second = source.length > 1 && n % 2 === 1 ? source[(n + 1) % source.length] : null
  const picked = [first, ...(second && second.variantId !== first.variantId ? [second] : [])]
  const locker = n % 3 !== 2
  const cod = n % 4 === 3
  const deliveryPrice = locker ? 999 : 1599
  const lines = picked.map((o) => ({ offerId: o.remoteId, externalId: o.variantId, sku: o.sku, ean: o.ean, name: o.title, quantity: 1, unitPriceMinor: o.priceMinor }))
  const address = { street: "ul. Przykładowa", building: String(10 + (n % 40)), flat: null, city: "Warszawa", postCode: "00-001", countryCode: "PL" }
  return {
    id,
    status: "CREATED",
    createdAt: now.toISOString(),
    currency: "PLN",
    totalMinor: lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0) + deliveryPrice,
    buyer: { firstName: "Klient", lastName: `Demo ${n + 1}`, email: `buyer${n + 1}@example.com`, phone: "+48500000000", address },
    delivery: locker
      ? { type: "APM", point: LOCKERS[n % LOCKERS.length], name: "Paczkomat (demo)", address: null, phone: "+48500000000", priceMinor: deliveryPrice }
      : { type: "COURIER", point: null, name: "Kurier (demo)", address, phone: "+48500000000", priceMinor: deliveryPrice },
    invoice: null,
    lines,
    paymentType: cod ? "CASH_ON_DELIVERY" : "BLIK_CODE",
    paid: !cod,
    comment: "Simulated order (demo)",
  }
}

/** A sample tracking number in the shape of a 24 digit parcel number, never a real one (starts with 99). */
export function demoTrackingNumber(seed: string): string {
  const digits = createHash("sha256").update(seed).digest("hex").replace(/[a-f]/g, "").padEnd(22, "7").slice(0, 22)
  return `99${digits}`
}
