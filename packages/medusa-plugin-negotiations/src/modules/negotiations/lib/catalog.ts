/**
 * READING THE CATALOG FOR A THREAD. Pure, tested with `node --test`.
 *
 * The flows read products, variants and carts through Medusa's Query and
 * hand the raw records here: which price is the list price, what a cart
 * line looks like in the thread's snapshot, what a thread is called.
 */

import { amountFromMedusa, multiply } from "./money"
import type { CartLine } from "./rows"

export interface PriceRecord {
  amount?: unknown
  currency_code?: string | null
  min_quantity?: unknown
  max_quantity?: unknown
  price_list_id?: string | null
  rules_count?: unknown
}

function quantityBound(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * The catalog price of a variant in a currency for a quantity: the base
 * prices (no price list), preferring those without rules (region prices
 * and the like), the tier the quantity falls into, the lowest of those.
 * Null when the variant has no price in the currency. For the record of the
 * thread only ("list price"), never charged.
 */
export function pickListPrice(prices: ReadonlyArray<PriceRecord | null> | null | undefined, currency: string, qty: number, digits: number): number | null {
  const inCurrency = (prices ?? []).filter((p): p is PriceRecord => Boolean(p) && String(p?.currency_code ?? "").toLowerCase() === currency && !p?.price_list_id)
  const fits = inCurrency.filter((p) => {
    const min = quantityBound(p.min_quantity)
    const max = quantityBound(p.max_quantity)
    return (min === null || qty >= min) && (max === null || qty <= max)
  })
  const plain = fits.filter((p) => !Number(p.rules_count))
  const pool = plain.length > 0 ? plain : fits
  let best: number | null = null
  for (const p of pool) {
    const amount = amountFromMedusa(p.amount, digits)
    if (amount !== null && amount > 0 && (best === null || amount < best)) best = amount
  }
  return best
}

/** "Drill / 18V" from a product and a variant title; the product alone when the variant adds nothing. */
export function threadTitle(productTitle: string | null | undefined, variantTitle: string | null | undefined): string | null {
  const p = (productTitle ?? "").trim()
  const v = (variantTitle ?? "").trim()
  if (!p) return v || null
  if (!v || v === p || /^default( variant| title)?$/i.test(v)) return p
  return `${p} / ${v}`
}

export interface CartItemRecord {
  variant_id?: string | null
  product_id?: string | null
  variant_sku?: string | null
  title?: string | null
  product_title?: string | null
  variant_title?: string | null
  quantity?: unknown
  unit_price?: unknown
}

/** The cart's lines as the thread keeps them, and their value at the cart's own prices. */
export function cartSnapshot(items: ReadonlyArray<CartItemRecord | null> | null | undefined, digits: number): { lines: CartLine[]; total: number | null } {
  const lines: CartLine[] = []
  let total: number | null = 0
  for (const item of items ?? []) {
    if (!item) continue
    const quantity = Number(item.quantity)
    if (!Number.isInteger(quantity) || quantity <= 0) continue
    const unit = amountFromMedusa(item.unit_price, digits)
    lines.push({
      variant_id: item.variant_id ?? null,
      product_id: item.product_id ?? null,
      sku: item.variant_sku ?? null,
      title: threadTitle(item.product_title ?? item.title, item.variant_title) ?? item.title ?? "",
      quantity,
      unit_amount: unit,
    })
    const line = multiply(unit, quantity)
    total = total === null || line === null ? null : total + line
  }
  return { lines, total: lines.length > 0 ? total : null }
}
