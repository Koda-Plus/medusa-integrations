/**
 * NET PRICES, GROSS ON CENEO. Pure, zero imports.
 *
 * Ceneo shows consumers gross prices. A B2B store often keeps net prices
 * (`is_tax_inclusive = false`) and adds VAT in the cart: the feed then adds
 * the rates Medusa's tax module gives for Poland, the same sum the store
 * routes use (`calculateAmountsWithTax`). Without a rate the price stays net
 * and the variant keeps the `price_net` error.
 */

export interface TaxLineLite {
  line_item_id: string
  rate?: number | string | null
}

/** The rates per item, in percent; items without a usable rate are left out. */
export function ratesByItem(lines: readonly TaxLineLite[]): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const l of lines) {
    const rate = typeof l.rate === "number" ? l.rate : Number(l.rate)
    if (!l.line_item_id || l.rate === null || l.rate === undefined || !Number.isFinite(rate) || rate < 0) continue
    const list = out.get(l.line_item_id) ?? []
    list.push(rate)
    out.set(l.line_item_id, list)
  }
  return out
}

/** Net plus the summed rates, rounded to grosze. */
export function grossFromNet(net: number, rates: readonly number[]): number {
  const sum = rates.reduce((a, b) => a + b, 0)
  return Math.round(net * (1 + sum / 100) * 100) / 100
}
