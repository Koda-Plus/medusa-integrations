import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { OMNIBUS_WINDOW_DAYS } from "./constants"
import { complianceSvc } from "./store"

/**
 * Omnibus price transparency: reads the BASE price of every catalog variant
 * (the price with no price list and no quantity tier, exactly like
 * seed-pricing) and snapshots it, so the "lowest price of the last 30 days"
 * can be shown next to a discount. Medusa does not keep price history, so the
 * snapshots are the history.
 *
 * Amounts are in the SAME UNITS as `price.amount` of this store (major units
 * in the Koda demo: 549 means 549.00 PLN), so the panel and the storefront
 * compare them to the displayed prices directly, without conversion.
 */

export interface VariantPrice {
  variant_id: string
  sku: string
  product_id: string
  title: string | null
  /** Base amount per currency (minor units). */
  byCurrency: Record<string, number>
}

type RawVariant = {
  id: string
  sku?: string | null
  product_id?: string | null
  product?: { title?: string | null } | null
  prices?: Array<{ amount?: number | null; currency_code?: string | null; price_list_id?: string | null; min_quantity?: number | null; max_quantity?: number | null } | null> | null
}

/** The currencies of the store's regions (pln, eur...), lower case. */
async function currencies(scope: MedusaContainer): Promise<Set<string>> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "region", fields: ["currency_code"] })
  const out = new Set<string>()
  for (const r of (data as Array<{ currency_code?: string | null }> | undefined) ?? []) {
    const c = String(r.currency_code ?? "").toLowerCase()
    if (c) out.add(c)
  }
  return out
}

/** All catalog variants with a SKU and their base price per currency. */
export async function readVariants(scope: MedusaContainer): Promise<VariantPrice[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const curs = await currencies(scope)
  const { data } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "product_id", "product.title", "prices.amount", "prices.currency_code", "prices.price_list_id", "prices.min_quantity", "prices.max_quantity"],
  })
  const rows = (data as RawVariant[] | undefined) ?? []
  const out: VariantPrice[] = []
  for (const v of rows) {
    if (typeof v.sku !== "string" || !v.sku.trim()) continue
    const byCurrency: Record<string, number> = {}
    for (const p of v.prices ?? []) {
      const c = String(p?.currency_code ?? "").toLowerCase()
      if (!curs.has(c) || p?.price_list_id || p?.min_quantity != null || p?.max_quantity != null) continue
      if (byCurrency[c] === undefined) byCurrency[c] = Number(p?.amount ?? 0)
    }
    out.push({
      variant_id: v.id,
      sku: v.sku,
      product_id: String(v.product_id ?? ""),
      title: v.product?.title ?? null,
      byCurrency,
    })
  }
  return out
}

/** Snapshots the current base prices. Idempotent in effect: a snapshot is a point in time. */
export async function capturePrices(scope: MedusaContainer): Promise<number> {
  const svc = complianceSvc(scope)
  const variants = await readVariants(scope)
  const now = new Date()
  const rows: Array<Record<string, unknown>> = []
  for (const v of variants) {
    for (const [currency, amount] of Object.entries(v.byCurrency)) {
      rows.push({ variant_id: v.variant_id, sku: v.sku, currency_code: currency, amount, captured_at: now })
    }
  }
  if (rows.length > 0) await svc.createCompliancePriceSnapshots(rows)
  return rows.length
}

export interface PriceWindow {
  sku: string
  variant_id: string
  product_id: string
  title: string | null
  currency_code: string
  /** Current base amount, in the store's price units. */
  amount: number
  /** Lowest amount in the last 30 days (snapshots plus the current price). */
  lowest_30d: number
  /**
   * Lowest snapshot amount in the last 30 days EXCLUDING the current price:
   * the reference the Omnibus Directive asks for when a price reduction is
   * announced. Null when there is no such history.
   */
  lowest_before: number | null
  snapshots: number
}

/** The snapshots of one window, as the pure computation reads them. */
export interface WindowSnapshot {
  sku: string
  currency_code: string
  amount: number
}

/**
 * The Omnibus window of one SKU and currency, pure (no database): the lowest
 * amount of the window (snapshots plus the current price) and the lowest
 * snapshot EXCLUDING the current price, the reference the directive asks for
 * when a reduction is announced.
 */
export function windowOf(sku: string, currency: string, amount: number, snapshots: WindowSnapshot[]): { lowest_30d: number; lowest_before: number | null; snapshots: number } {
  const hist = snapshots.filter((s) => s.sku === sku && s.currency_code.toLowerCase() === currency.toLowerCase()).map((s) => s.amount)
  const lowest = Math.min(amount, ...hist)
  const prior = hist.filter((a) => a !== amount)
  return { lowest_30d: lowest, lowest_before: prior.length > 0 ? Math.min(...prior) : null, snapshots: hist.length }
}

/** Current price vs the lowest of the last 30 days, per variant and currency. */
export async function priceWindows(scope: MedusaContainer): Promise<PriceWindow[]> {
  const svc = complianceSvc(scope)
  const variants = await readVariants(scope)
  const since = new Date(Date.now() - OMNIBUS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const snaps = await svc.listCompliancePriceSnapshots({ captured_at: { $gte: since } }, { take: 10_000 })
  const snapshots: WindowSnapshot[] = []
  for (const s of snaps) {
    const sku = typeof s.sku === "string" ? s.sku : ""
    const currency = typeof s.currency_code === "string" ? s.currency_code.toLowerCase() : ""
    const amount = Number(s.amount)
    if (!sku || !currency || !Number.isFinite(amount)) continue
    snapshots.push({ sku, currency_code: currency, amount })
  }

  const out: PriceWindow[] = []
  for (const v of variants) {
    for (const [currency, amount] of Object.entries(v.byCurrency)) {
      const window = windowOf(v.sku, currency, amount, snapshots)
      out.push({
        sku: v.sku,
        variant_id: v.variant_id,
        product_id: v.product_id,
        title: v.title,
        currency_code: currency,
        amount,
        lowest_30d: window.lowest_30d,
        lowest_before: window.lowest_before,
        snapshots: window.snapshots,
      })
    }
  }
  return out
}
