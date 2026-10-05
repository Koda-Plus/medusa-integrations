/**
 * ALERTS: WHERE OLX AND THE STORE DISAGREE. Pure, no Medusa imports.
 *
 *   live_sold_out      an advert is live on OLX while its variant is sold out
 *                      in Medusa: a buyer can call about an item you no longer have
 *   live_unpublished   an advert is live while the product is not published
 *                      (draft, proposed, rejected) in Medusa
 *   stock_not_live     the variant is in stock and published, it has adverts on
 *                      OLX, but none of them is live (ended, over the package
 *                      limit, removed): sales you are missing
 *   stock_not_listed   in stock and published, with a SKU, and never on OLX
 *
 * One alert per live advert for the first two kinds (each advert needs its own
 * action), one per variant for the other two. An advert waiting for moderation
 * (`new`) counts as on its way, not as missing. Stock must be a positive fact
 * (see `stock.ts`): unknown stock raises nothing.
 */

import { hasStock, isPublished, isSoldOut, stockUnits, type StockState } from "./stock"

export type AlertKind = "live_sold_out" | "live_unpublished" | "stock_not_live" | "stock_not_listed"

export const ALERT_KINDS: readonly AlertKind[] = ["live_sold_out", "live_unpublished", "stock_not_live", "stock_not_listed"]

/** Statuses that mean "OLX is still deciding", not "ended". */
export const PENDING_STATUSES: readonly string[] = ["new"]

export interface AlertAdvert {
  olxId: string
  title: string
  url: string
  status: string
  variantId: string | null
}

export interface AlertVariant {
  id: string
  productId: string
  sku: string | null
  productTitle: string | null
  productStatus: string | null
  stock: StockState
}

export interface Alert {
  kind: AlertKind
  /** Stable key, so an alert that stays keeps its "first seen" date. */
  key: string
  variantId: string
  productId: string
  sku: string | null
  productTitle: string | null
  olxId: string | null
  advertTitle: string | null
  advertUrl: string | null
  advertStatus: string | null
  /** Available units; null when the variant does not track stock. */
  stock: number | null
  productStatus: string | null
}

export type AlertCounts = Record<AlertKind, number>

export function emptyAlertCounts(): AlertCounts {
  return { live_sold_out: 0, live_unpublished: 0, stock_not_live: 0, stock_not_listed: 0 }
}

function statusRank(status: string): number {
  if (status === "active") return 3
  if (PENDING_STATUSES.includes(status)) return 2
  if (status === "limited") return 1
  return 0
}

function newestFirst(a: AlertAdvert, b: AlertAdvert): number {
  const na = Number(a.olxId)
  const nb = Number(b.olxId)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return nb - na
  return a.olxId < b.olxId ? 1 : a.olxId > b.olxId ? -1 : 0
}

/** The advert that best represents a variant that is not live: over the limit first, then the newest. */
function representative(list: readonly AlertAdvert[]): AlertAdvert | null {
  if (list.length === 0) return null
  return [...list].sort((a, b) => statusRank(b.status) - statusRank(a.status) || newestFirst(a, b))[0]
}

export function computeAlerts(
  adverts: readonly AlertAdvert[],
  variants: ReadonlyMap<string, AlertVariant>,
): { alerts: Alert[]; counts: AlertCounts } {
  const byVariant = new Map<string, AlertAdvert[]>()
  for (const a of adverts) {
    if (!a.variantId) continue
    const list = byVariant.get(a.variantId) ?? []
    list.push(a)
    byVariant.set(a.variantId, list)
  }

  const alerts: Alert[] = []
  const base = (v: AlertVariant) => ({
    variantId: v.id,
    productId: v.productId,
    sku: v.sku,
    productTitle: v.productTitle,
    stock: stockUnits(v.stock),
    productStatus: v.productStatus,
  })

  for (const a of adverts) {
    if (a.status !== "active" || !a.variantId) continue
    const v = variants.get(a.variantId)
    if (!v) continue
    let kind: AlertKind | null = null
    if (!isPublished(v.productStatus)) kind = "live_unpublished"
    else if (isSoldOut(v.stock)) kind = "live_sold_out"
    if (!kind) continue
    alerts.push({
      kind,
      key: `${kind}:${v.id}:${a.olxId}`,
      ...base(v),
      olxId: a.olxId,
      advertTitle: a.title,
      advertUrl: a.url,
      advertStatus: a.status,
    })
  }

  for (const v of variants.values()) {
    if (!isPublished(v.productStatus) || !hasStock(v.stock) || !v.sku) continue
    const linked = byVariant.get(v.id) ?? []
    if (linked.length === 0) {
      alerts.push({
        kind: "stock_not_listed",
        key: `stock_not_listed:${v.id}:`,
        ...base(v),
        olxId: null,
        advertTitle: null,
        advertUrl: null,
        advertStatus: null,
      })
      continue
    }
    if (linked.some((a) => a.status === "active" || PENDING_STATUSES.includes(a.status))) continue
    const rep = representative(linked)
    alerts.push({
      kind: "stock_not_live",
      key: `stock_not_live:${v.id}:`,
      ...base(v),
      olxId: rep?.olxId ?? null,
      advertTitle: rep?.title ?? null,
      advertUrl: rep?.url ?? null,
      advertStatus: rep?.status ?? null,
    })
  }

  const order = new Map(ALERT_KINDS.map((k, i) => [k, i]))
  alerts.sort(
    (x, y) =>
      (order.get(x.kind) ?? 0) - (order.get(y.kind) ?? 0) ||
      String(x.productTitle ?? "").localeCompare(String(y.productTitle ?? "")) ||
      x.key.localeCompare(y.key),
  )
  const counts = emptyAlertCounts()
  for (const a of alerts) counts[a.kind] += 1
  return { alerts, counts }
}
