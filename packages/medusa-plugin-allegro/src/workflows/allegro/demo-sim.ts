/**
 * THE SIMULATED ALLEGRO ACCOUNT OF DEMO MODE, with memory.
 *
 * The offers and the purchases come from the catalog and the day
 * (`lib/demo.ts`, `lib/demo-stream.ts`), so they are the same in every
 * process. What the demo WRITERS change (a lowered quantity, an ended offer,
 * a new price, a draft, a parcel, a seller status, an invoice) is kept in
 * one overlay row (`allegro_state.demo_overlay`) and applied on top, so the
 * next read shows the change exactly as a real account would. Offer changes
 * reset every day (the catalog-built account starts fresh each morning);
 * order-side changes are kept for a week.
 */

import type AllegroModuleService from "../../modules/allegro/service"
import { buildDemoRawOffers } from "../../modules/allegro/lib/demo"
import {
  dayStart,
  demoCheckoutFormRaw,
  demoOffersFromRaw,
  demoSeedsUntil,
  type DemoFormSeed,
  type DemoOffer,
} from "../../modules/allegro/lib/demo-stream"
import { demoPrices, type QueryLike, type StockedVariant } from "./catalog"
import { getState, setState } from "./runtime"

const DAY_MS = 24 * 60 * 60 * 1000
const OVERLAY_ID = "demo_overlay"

export interface DemoParcel {
  id: string
  waybill: string
  carrierId: string
  carrierName: string | null
  lineItemIds: string[]
  createdAt: string
}

export interface DemoInvoice {
  id: string
  number: string | null
  fileName: string
  bytes: number
  createdAt: string
}

export interface DemoOverlay {
  /** The UTC day the offer changes belong to. */
  day: string
  offers: Record<string, { available?: number; status?: string; price?: { amount: string; currency: string } }>
  drafts: Record<string, { offerId: string; sku: string; name: string; price: { amount: string; currency: string } | null; available: number; createdAt: string }>
  fulfillment: Record<string, { status: string; at: string }>
  parcels: Record<string, DemoParcel[]>
  invoices: Record<string, DemoInvoice[]>
}

function today(): string {
  return dayStart(new Date()).toISOString().slice(0, 10)
}

function empty(day: string): DemoOverlay {
  return { day, offers: {}, drafts: {}, fulfillment: {}, parcels: {}, invoices: {} }
}

export async function loadOverlay(svc: AllegroModuleService): Promise<DemoOverlay> {
  const stored = await getState<DemoOverlay>(svc, OVERLAY_ID)
  const day = today()
  if (!stored || typeof stored !== "object") return empty(day)
  const o: DemoOverlay = {
    day: stored.day ?? day,
    offers: stored.offers ?? {},
    drafts: stored.drafts ?? {},
    fulfillment: stored.fulfillment ?? {},
    parcels: stored.parcels ?? {},
    invoices: stored.invoices ?? {},
  }
  if (o.day !== day) {
    /* A new day: the catalog-built offers start fresh, orders keep their history for a week. */
    const keepAfter = Date.now() - 7 * DAY_MS
    const fresh = (at: string | undefined) => !at || Date.parse(at) >= keepAfter
    return {
      day,
      offers: {},
      drafts: {},
      fulfillment: Object.fromEntries(Object.entries(o.fulfillment).filter(([, v]) => fresh(v.at))),
      parcels: Object.fromEntries(Object.entries(o.parcels).filter(([, v]) => v.some((p) => fresh(p.createdAt)))),
      invoices: Object.fromEntries(Object.entries(o.invoices).filter(([, v]) => v.some((i) => fresh(i.createdAt)))),
    }
  }
  return o
}

export async function saveOverlay(svc: AllegroModuleService, overlay: DemoOverlay): Promise<void> {
  await setState(svc, OVERLAY_ID, overlay)
}

/** Read, change, write. One process changes the overlay at a time (the demo runs in one process). */
export async function updateOverlay(svc: AllegroModuleService, change: (o: DemoOverlay) => void): Promise<DemoOverlay> {
  const o = await loadOverlay(svc)
  change(o)
  await saveOverlay(svc, o)
  return o
}

/** Midnight UTC: the demo then changes nothing within a day and still looks fresh every day. */
export function demoDay(): Date {
  return dayStart(new Date())
}

/** The first twelve variants by SKU, as the demo account lists them. */
export function demoPicked(variants: readonly StockedVariant[]): StockedVariant[] {
  return [...variants].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)).slice(0, 12)
}

/**
 * Raw objects shaped like `GET /sale/offers` items: the catalog-built offers
 * of today with what the demo writers changed, plus the drafts they created.
 */
export async function demoOffersRaw(query: QueryLike, variants: readonly StockedVariant[], overlay: DemoOverlay | null = null): Promise<Record<string, unknown>[]> {
  const picked = demoPicked(variants)
  const prices = await demoPrices(
    query,
    picked.map((v) => v.id),
  )
  const raw = buildDemoRawOffers(
    picked.map((v) => ({ sku: v.sku, productTitle: v.productTitle ?? v.sku, price: prices.get(v.id) ?? null, available: v.available })),
    demoDay(),
  )
  if (!overlay) return raw
  for (const offer of raw) {
    const change = overlay.offers[String(offer.id)]
    if (!change) continue
    if (change.available !== undefined) offer.stock = { ...((offer.stock as Record<string, unknown>) ?? {}), available: change.available }
    if (change.status) offer.publication = { ...((offer.publication as Record<string, unknown>) ?? {}), status: change.status, endedBy: change.status === "ENDED" ? "USER" : null }
    if (change.price) offer.sellingMode = { ...((offer.sellingMode as Record<string, unknown>) ?? {}), price: change.price }
  }
  for (const draft of Object.values(overlay.drafts)) {
    raw.push({
      id: draft.offerId,
      name: draft.name.slice(0, 75),
      category: { id: "260000" },
      sellingMode: { format: "BUY_NOW", price: draft.price },
      saleInfo: { currentPrice: null, biddersCount: 0 },
      stock: { available: draft.available, sold: 0 },
      publication: { status: "INACTIVE", startedAt: null, endingAt: null, endedBy: null },
      external: { id: draft.sku },
    })
  }
  return raw
}

export interface DemoStream {
  offers: DemoOffer[]
  seeds: DemoFormSeed[]
  overlay: DemoOverlay
  now: Date
}

/** The purchases of yesterday and today up to now, from the demo offers. */
export async function demoStream(svc: AllegroModuleService, query: QueryLike, variants: readonly StockedVariant[], days = 2): Promise<DemoStream> {
  const overlay = await loadOverlay(svc)
  const offers = demoOffersFromRaw(await demoOffersRaw(query, variants, overlay))
  const now = new Date()
  const start = dayStart(now)
  const dayList = Array.from({ length: days }, (_, i) => new Date(start.getTime() - (days - 1 - i) * DAY_MS))
  return { offers, seeds: demoSeedsUntil(offers, dayList, now), overlay, now }
}

export function demoFormFromStream(stream: DemoStream, checkoutFormId: string): Record<string, unknown> | null {
  const seed = stream.seeds.find((s) => s.id === checkoutFormId)
  if (!seed) return null
  return demoCheckoutFormRaw(seed, stream.now, stream.overlay.fulfillment[checkoutFormId]?.status ?? null)
}
