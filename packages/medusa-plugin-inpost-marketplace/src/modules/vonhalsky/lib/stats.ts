/**
 * THE STATISTICS, as pure functions over the plugin's own rows (orders,
 * offers, after sale cases, daily snapshots) and the Medusa orders of the
 * other sales channels. Everything here is something the seller API really
 * returns; views, click-through, ratings and payouts are not in it and are
 * listed in `NOT_AVAILABLE` instead of being guessed.
 */

import type { StatsResponse } from "./contract"
import { fromMinor } from "./pricing"

type Row = Record<string, any>

export const STATS_WINDOWS = [7, 30, 90] as const

/** What the seller API does not expose (the panel names them, it does not estimate them). */
export const NOT_AVAILABLE = ["views", "ctr", "ratings", "payouts"] as const

const CANCELLED = new Set(["CANCELED", "CANCELLED", "REFUSED", "REJECTED"])
const HOUR = 60 * 60 * 1000

const money = (minor: number): string => fromMinor(minor) ?? "0.00"
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0)
const time = (v: unknown): number | null => {
  if (!v) return null
  const t = new Date(v as string).getTime()
  return Number.isFinite(t) ? t : null
}
const dayOf = (t: number): string => new Date(t).toISOString().slice(0, 10)

/** The value at a fraction of a sorted list (nearest rank), null for an empty one. */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return Math.round(sorted[i] * 10) / 10
}

function tally(values: Array<string | null | undefined>, fallback = "UNKNOWN"): Record<string, number> {
  const out: Record<string, number> = {}
  for (const v of values) {
    const k = v || fallback
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

interface OrderLine {
  offer_id: string
  quantity: number
  unit_price_minor: number
}

function linesOf(row: Row): OrderLine[] {
  if (!Array.isArray(row.lines)) return []
  return row.lines
    .filter((l: Row) => l && l.offer_id)
    .map((l: Row) => ({ offer_id: String(l.offer_id), quantity: Math.max(0, num(l.quantity)), unit_price_minor: num(l.unit_price_minor) }))
}

export interface OtherChannelOrder {
  sales_channel_id: string | null
  total_minor: number
  created_at: string | Date
}

export interface StatsInput {
  days: number
  now: Date
  /** Marketplace order rows placed in the window. */
  orders: Row[]
  /** Every offer row (status, stock, promotion, validation...). */
  offers: Row[]
  /** After sale cases opened in the window. */
  cases: Row[]
  /** Daily snapshots of the window, any order. */
  snapshots: Row[]
  /** PLN orders of the other Medusa sales channels placed in the window. */
  otherOrders: OtherChannelOrder[]
  channelNames: Map<string, string>
  daysToShip: number
}

export function computeStats(x: StatsInput): StatsResponse {
  const from = new Date(x.now.getTime() - x.days * 24 * HOUR)
  const placed = (r: Row) => time(r.placed_at) ?? time(r.created_at) ?? 0
  const live = x.orders.filter((r) => !CANCELLED.has(String(r.remote_status ?? "")) && (Boolean(r.paid_at) || (r.remote_status && r.remote_status !== "CREATED")))
  const revenueMinor = live.reduce((s, r) => s + num(r.total_minor), 0)

  /* Revenue by day, every day of the window present. */
  const daily = new Map<string, { revenue: number; orders: number }>()
  for (let t = from.getTime(); t <= x.now.getTime(); t += 24 * HOUR) daily.set(dayOf(t), { revenue: 0, orders: 0 })
  for (const r of live) {
    const d = daily.get(dayOf(placed(r)))
    if (d) {
      d.revenue += num(r.total_minor)
      d.orders += 1
    }
  }

  const byChannel = new Map<string, { revenue: number; orders: number }>()
  for (const o of x.otherOrders) {
    const id = o.sales_channel_id ?? "none"
    const c = byChannel.get(id) ?? { revenue: 0, orders: 0 }
    c.revenue += o.total_minor
    c.orders += 1
    byChannel.set(id, c)
  }

  /* Units and revenue per marketplace offer, from the lines of imported orders. */
  const sold = new Map<string, { units: number; revenue: number }>()
  for (const r of live) {
    for (const l of linesOf(r)) {
      const s = sold.get(l.offer_id) ?? { units: 0, revenue: 0 }
      s.units += l.quantity
      s.revenue += l.quantity * l.unit_price_minor
      sold.set(l.offer_id, s)
    }
  }
  const afterSaleByOffer = new Map<string, { returns: number; claims: number }>()
  for (const c of x.cases) {
    if (c.kind !== "return" && c.kind !== "claim") continue
    for (const l of Array.isArray(c.lines) ? c.lines : []) {
      if (!l?.offerId) continue
      const a = afterSaleByOffer.get(String(l.offerId)) ?? { returns: 0, claims: 0 }
      if (c.kind === "return") a.returns += Math.max(1, num(l.quantity))
      else a.claims += Math.max(1, num(l.quantity))
      afterSaleByOffer.set(String(l.offerId), a)
    }
  }
  const offerByRemote = new Map(x.offers.filter((o) => o.remote_id).map((o) => [String(o.remote_id), o]))

  const listed = x.offers.filter((o) => o.status === "listed")
  const unsold = listed.filter((o) => !sold.has(String(o.remote_id ?? "")))
  const unitsSold = [...sold.values()].reduce((s, v) => s + v.units, 0)
  const unitsInStock = listed.reduce((s, o) => s + Math.max(0, num(o.stock)), 0)

  const validation = new Map<string, { message: string | null; count: number }>()
  for (const o of x.offers) {
    if (o.remote_status !== "PENDING" && o.remote_status !== "REJECTED") continue
    for (const v of Array.isArray(o.validation) ? o.validation : []) {
      if (!v?.code) continue
      const e = validation.get(String(v.code)) ?? { message: v.message ?? null, count: 0 }
      e.count += 1
      validation.set(String(v.code), e)
    }
  }

  const fromDay = dayOf(from.getTime())
  const history = x.snapshots
    .filter((s) => String(s.day) >= fromDay)
    .sort((a, b) => String(a.day).localeCompare(String(b.day)))
    .map((s) => ({ day: String(s.day), published: num(s.data?.published), pending: num(s.data?.pending), soldout: num(s.data?.soldout), closed: num(s.data?.closed) }))

  const products = [...sold.entries()]
    .map(([offerId, s]) => {
      const o = offerByRemote.get(offerId)
      const a = afterSaleByOffer.get(offerId) ?? { returns: 0, claims: 0 }
      return { offer_id: offerId, title: o?.title ?? null, sku: o?.sku ?? null, units: s.units, revenueMinor: s.revenue, returns: a.returns, claims: a.claims }
    })
    .sort((a, b) => b.revenueMinor - a.revenueMinor || b.units - a.units)
    .slice(0, 20)
    .map(({ revenueMinor, ...p }) => ({ ...p, revenue: money(revenueMinor) }))

  const toShip: number[] = []
  const toDeliver: number[] = []
  let late = 0
  for (const r of live) {
    const paid = time(r.paid_at)
    const shipped = time(r.shipped_at)
    const expected = time(r.expected_delivery_at)
    if (paid !== null && shipped !== null && shipped >= paid) toShip.push((shipped - paid) / HOUR)
    if (shipped !== null && expected !== null && expected >= shipped) toDeliver.push((expected - shipped) / HOUR)
    if (paid !== null && shipped === null && x.now.getTime() - paid > x.daysToShip * 24 * HOUR) late += 1
  }

  const discounted = live.filter((r) => num(r.promotion_discount_minor) + num(r.program_discount_minor) > 0)
  const returns = x.cases.filter((c) => c.kind === "return")
  const claims = x.cases.filter((c) => c.kind === "claim")
  const refunds = x.cases.filter((c) => c.kind === "refund")
  const rate = (n: number) => (live.length ? Math.round((n / live.length) * 1000) / 10 : null)
  const reasons = tally([...returns, ...claims].map((c) => c.reason), "unknown")

  return {
    days: x.days,
    from: from.toISOString(),
    currency: "pln",
    revenue: {
      vonhalsky: money(revenueMinor),
      orders: live.length,
      aov: live.length ? money(Math.round(revenueMinor / live.length)) : null,
      otherChannels: [...byChannel.entries()]
        .map(([id, c]) => ({ id, name: x.channelNames.get(id) ?? id, revenue: money(c.revenue), orders: c.orders, minor: c.revenue }))
        .sort((a, b) => b.minor - a.minor)
        .map(({ minor: _minor, ...c }) => c),
      daily: [...daily.entries()].map(([day, d]) => ({ day, revenue: money(d.revenue), orders: d.orders })),
    },
    offers: {
      byStatus: tally(x.offers.map((o) => (o.status === "listed" ? (o.remote_status ?? "LISTED") : String(o.status).toUpperCase()))),
      listed: listed.length,
      noSales: unsold.length,
      noSalesSample: unsold
        .sort((a, b) => num(b.stock) - num(a.stock))
        .slice(0, 10)
        .map((o) => ({ id: String(o.id), title: o.title ?? null, sku: o.sku ?? null, stock: num(o.stock) })),
      sellThrough: unitsSold + unitsInStock > 0 ? Math.round((unitsSold / (unitsSold + unitsInStock)) * 1000) / 10 : null,
      withPromotion: x.offers.filter((o) => o.promotion).length,
      inProgram: x.offers.filter((o) => o.program === "IN").length,
      pending: x.offers.filter((o) => o.remote_status === "PENDING").length,
      rejected: x.offers.filter((o) => o.remote_status === "REJECTED").length,
      topValidation: [...validation.entries()]
        .map(([code, v]) => ({ code, message: v.message, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      history,
    },
    products,
    fulfilment: {
      toShipHours: { median: quantile(toShip, 0.5), p90: quantile(toShip, 0.9), count: toShip.length },
      toDeliveryHours: { median: quantile(toDeliver, 0.5), count: toDeliver.length },
      late,
    },
    mix: {
      delivery: tally(live.map((r) => r.delivery_type)),
      payment: tally(live.map((r) => r.payment_type)),
      buyer: tally(live.map((r) => r.buyer_kind)),
    },
    discounts: {
      promotion: money(live.reduce((s, r) => s + num(r.promotion_discount_minor), 0)),
      program: money(live.reduce((s, r) => s + num(r.program_discount_minor), 0)),
      discountedRevenue: money(discounted.reduce((s, r) => s + num(r.total_minor) - num(r.delivery_minor), 0)),
      discountedUnits: discounted.reduce((s, r) => s + linesOf(r).reduce((u, l) => u + l.quantity, 0), 0),
    },
    afterSale: {
      returns: returns.length,
      claims: claims.length,
      refunds: refunds.length,
      refunded: money(live.reduce((s, r) => s + num(r.refunded_minor), 0)),
      returnRate: rate(live.filter((r) => num(r.returns_count) > 0).length),
      claimRate: rate(live.filter((r) => num(r.claims_count) > 0).length),
      topReasons: Object.entries(reasons)
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    },
    notAvailable: [...NOT_AVAILABLE],
  }
}
