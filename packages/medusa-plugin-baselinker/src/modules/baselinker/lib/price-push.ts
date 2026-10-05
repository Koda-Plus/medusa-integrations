/**
 * PRICES FROM MEDUSA TO ONE BASELINKER PRICE GROUP, PLANNED BEFORE ANYTHING
 * IS WRITTEN. Pure; imports only other pure files of this folder.
 *
 * For stores whose catalog lives in Medusa. The price of a linked card in the
 * configured group (`priceGroupId`) should equal the variant's base price in
 * `priceCurrency` (no price list, no rules). BaseLinker keeps gross prices:
 * tax-inclusive Medusa prices go as they are, net prices are multiplied by
 * the card's VAT rate, and a card without a rate is left alone.
 *
 * Never touched: cards in conflict, variants without a base price in the
 * currency, and everything after an incomplete read.
 */

import { toBaseLinkerPrice } from "./catalog-import"

export interface PriceCard {
  blProductId: string
  variantId: string | null
  conflict: string | null
  /** Gross prices per price group, as the list read returned them. */
  prices: Record<string, number> | null
}

export interface PriceVariant {
  id: string
  productId: string | null
  sku: string | null
  label: string
  /** Base price in the configured currency, major units. */
  price: number | null
}

export interface PriceChange {
  key: string
  blProductId: string
  variantId: string
  productId: string | null
  sku: string | null
  label: string
  from: number | null
  to: number
}

export interface PricePlan {
  skipped: null | "incomplete_read"
  changes: PriceChange[]
  stats: { linkedCards: number; considered: number; unchanged: number; toChange: number; noPrice: number; noRate: number }
}

export function planPricePush(input: {
  cards: readonly PriceCard[]
  variants: readonly PriceVariant[]
  complete: boolean
  priceGroupId: number
  taxInclusive: boolean
  /** VAT rates of the cards (from the product details), needed only for net Medusa prices. */
  rates?: ReadonlyMap<string, number | null>
}): PricePlan {
  const stats = { linkedCards: 0, considered: 0, unchanged: 0, toChange: 0, noPrice: 0, noRate: 0 }
  if (!input.complete) return { skipped: "incomplete_read", changes: [], stats }
  const group = String(input.priceGroupId)
  const variants = new Map(input.variants.map((v) => [v.id, v]))
  const changes: PriceChange[] = []
  for (const card of input.cards) {
    if (card.conflict || !card.variantId) continue
    const v = variants.get(card.variantId)
    if (!v) continue
    stats.linkedCards += 1
    if (v.price === null) {
      stats.noPrice += 1
      continue
    }
    const gross = toBaseLinkerPrice(v.price, input.rates?.get(card.blProductId) ?? null, input.taxInclusive)
    if (gross === null) {
      stats.noRate += 1
      continue
    }
    stats.considered += 1
    const current = card.prices && typeof card.prices[group] === "number" ? card.prices[group] : null
    if (current !== null && Math.abs(current - gross) < 0.005) {
      stats.unchanged += 1
      continue
    }
    changes.push({ key: `card:${card.blProductId}`, blProductId: card.blProductId, variantId: v.id, productId: v.productId, sku: v.sku, label: v.label, from: current, to: gross })
  }
  changes.sort((a, b) => ((a.sku ?? a.variantId) < (b.sku ?? b.variantId) ? -1 : 1))
  stats.toChange = changes.length
  return { skipped: null, changes, stats }
}

/** `updateInventoryProductsPrices` products map for one price group. */
export function pricePayload(changes: readonly PriceChange[], priceGroupId: number): Record<string, Record<string, number>> {
  return Object.fromEntries(changes.map((c) => [c.blProductId, { [String(priceGroupId)]: c.to }]))
}

/**
 * Why the configured price group must not be written, or null when it may:
 * it has to exist on the account, be a standard group (a derived group is
 * computed by BaseLinker from its source) and be in the Medusa currency the
 * prices come from.
 */
export function priceGroupProblem(
  groups: ReadonlyArray<{ id: number; name: string; currency: string; derived: boolean }>,
  priceGroupId: number,
  currency: string,
): string | null {
  const group = groups.find((g) => g.id === priceGroupId)
  if (!group) return `Price group ${priceGroupId} is not on this account`
  if (group.derived) return `Price group ${priceGroupId} (${group.name}) is derived from another group, so BaseLinker computes its prices`
  if (group.currency && group.currency.toLowerCase() !== currency.toLowerCase()) {
    return `Price group ${priceGroupId} is in ${group.currency.toUpperCase()}, while priceCurrency is ${currency.toUpperCase()}`
  }
  return null
}
