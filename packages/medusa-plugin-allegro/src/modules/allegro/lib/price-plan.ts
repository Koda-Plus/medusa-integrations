/**
 * THE PRICE PUSH PLAN. Pure arithmetic, zero imports.
 *
 * The Medusa price of a variant (its default price, or a price list when the
 * options name one) becomes the Buy Now price of its PRIMARY live offer,
 * inside BOUNDS read from metadata:
 *
 *   floor     `allegro_price_min` (variant, then product metadata), required
 *             by default: a price push without a floor is how a typo sells
 *             the stock at a loss;
 *   ceiling   `allegro_price_max`, optional.
 *
 * A price outside the bounds is REFUSED, never clamped: clamping would sell
 * at a price nobody set. A change bigger than `maxChangePercent` of the
 * current Allegro price is refused too, as a typo guard. Money stays in
 * grosze (integers) for every comparison; Allegro gets a string with two
 * decimals. No currency conversion: a variant without a price in the offer
 * currency is skipped.
 */

import type { PlanStatus } from "./stock-plan"

export type PriceReason =
  | "price_down"
  | "price_up"
  | "in_sync"
  | "no_price"
  | "no_floor"
  | "below_floor"
  | "above_ceiling"
  | "change_too_big"
  | "not_live"
  | "no_offer_price"
  | "bad_bounds"

export interface PricePlanOffer {
  allegroId: string
  name: string
  status: string
  price: { value: number; currency: string } | null
  variantId: string | null
  sku: string | null
  productId: string | null
  productTitle: string | null
  isPrimary: boolean
}

export interface PriceBounds {
  min: number | null
  max: number | null
}

export interface PricePlanEntry {
  allegroId: string
  name: string
  variantId: string | null
  sku: string | null
  productId: string | null
  productTitle: string | null
  current: { amount: string; currency: string } | null
  target: { amount: string; currency: string } | null
  bounds: PriceBounds
  reason: PriceReason
  status: PlanStatus
}

export interface PricePlanResult {
  entries: PricePlanEntry[]
  counts: { down: number; up: number; skipped: number; inSync: number; quarantined: number; deferred: number }
}

export function toCents(value: number): number {
  return Math.round(value * 100)
}

export function amountString(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(Math.round(cents))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
}

/** A metadata value as an amount: numbers and "123.45" or "123,45" strings; anything else is no bound. */
export function boundValue(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null
  if (typeof raw !== "string") return null
  const s = raw.trim().replace(/\s/g, "").replace(",", ".")
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function planPrices(input: {
  offers: readonly PricePlanOffer[]
  /** Variant id to its Medusa prices by currency (upper case), in major units. */
  medusa: ReadonlyMap<string, ReadonlyMap<string, number>>
  bounds: ReadonlyMap<string, PriceBounds>
  requireFloor: boolean
  maxChangePercent: number
  cap: number
  quarantined: ReadonlySet<string>
}): PricePlanResult {
  const entries: PricePlanEntry[] = []
  for (const o of input.offers) {
    if (!o.isPrimary || !o.variantId) continue
    const bounds = input.bounds.get(o.variantId) ?? { min: null, max: null }
    const base = {
      allegroId: o.allegroId,
      name: o.name,
      variantId: o.variantId,
      sku: o.sku,
      productId: o.productId,
      productTitle: o.productTitle,
      bounds,
    }
    const current = o.price ? { amount: amountString(toCents(o.price.value)), currency: o.price.currency.toUpperCase() } : null
    const status = o.status.toUpperCase()
    if (status !== "ACTIVE" && status !== "ACTIVATING") {
      entries.push({ ...base, current, target: null, reason: "not_live", status: "skipped" })
      continue
    }
    if (!o.price || !current) {
      entries.push({ ...base, current: null, target: null, reason: "no_offer_price", status: "skipped" })
      continue
    }
    const medusa = input.medusa.get(o.variantId)?.get(current.currency)
    if (medusa === undefined || !Number.isFinite(medusa) || medusa <= 0) {
      entries.push({ ...base, current, target: null, reason: "no_price", status: "skipped" })
      continue
    }
    const targetCents = toCents(medusa)
    const currentCents = toCents(o.price.value)
    const target = { amount: amountString(targetCents), currency: current.currency }
    if (targetCents === currentCents) {
      entries.push({ ...base, current, target, reason: "in_sync", status: "in_sync" })
      continue
    }
    if (bounds.min !== null && bounds.max !== null && toCents(bounds.min) > toCents(bounds.max)) {
      entries.push({ ...base, current, target, reason: "bad_bounds", status: "skipped" })
      continue
    }
    if (bounds.min === null && input.requireFloor) {
      entries.push({ ...base, current, target, reason: "no_floor", status: "skipped" })
      continue
    }
    if (bounds.min !== null && targetCents < toCents(bounds.min)) {
      entries.push({ ...base, current, target, reason: "below_floor", status: "skipped" })
      continue
    }
    if (bounds.max !== null && targetCents > toCents(bounds.max)) {
      entries.push({ ...base, current, target, reason: "above_ceiling", status: "skipped" })
      continue
    }
    if (currentCents > 0 && (Math.abs(targetCents - currentCents) * 100) / currentCents > input.maxChangePercent) {
      entries.push({ ...base, current, target, reason: "change_too_big", status: "skipped" })
      continue
    }
    entries.push({ ...base, current, target, reason: targetCents < currentCents ? "price_down" : "price_up", status: "planned" })
  }

  let budget = Math.max(0, Math.floor(input.cap))
  const planned = entries
    .filter((e) => e.status === "planned")
    .sort((a, b) => (a.reason === b.reason ? (a.allegroId < b.allegroId ? -1 : 1) : a.reason === "price_down" ? 1 : -1))
  for (const e of planned) {
    if (input.quarantined.has(e.allegroId)) e.status = "quarantined"
    else if (budget > 0) budget -= 1
    else e.status = "deferred"
  }

  const counts = { down: 0, up: 0, skipped: 0, inSync: 0, quarantined: 0, deferred: 0 }
  for (const e of entries) {
    if (e.status === "in_sync") counts.inSync += 1
    else if (e.status === "skipped") counts.skipped += 1
    else if (e.status === "quarantined") counts.quarantined += 1
    else if (e.status === "deferred") counts.deferred += 1
    else if (e.reason === "price_down") counts.down += 1
    else counts.up += 1
  }
  return { entries, counts }
}

/**
 * Right before the command: the offer is still live, the price Allegro shows
 * NOW still differs from the target, and it is still the price the plan
 * started from. A price somebody changed on Allegro after the plan is not
 * overwritten: the floor, the ceiling and the change limit were checked
 * against the old one, so the item waits for the next plan.
 */
export function recheckPrice(
  target: { amount: string; currency: string },
  fresh: { status: string; price: { value: number; currency: string } | null } | null,
  planned: { amount: string; currency: string } | null = null,
): boolean {
  if (!fresh || !fresh.price) return false
  const s = fresh.status.toUpperCase()
  if (s !== "ACTIVE" && s !== "ACTIVATING") return false
  if (fresh.price.currency.toUpperCase() !== target.currency) return false
  if (planned && (planned.currency.toUpperCase() !== target.currency || toCents(fresh.price.value) !== toCents(Number(planned.amount)))) return false
  return toCents(fresh.price.value) !== toCents(Number(target.amount))
}
