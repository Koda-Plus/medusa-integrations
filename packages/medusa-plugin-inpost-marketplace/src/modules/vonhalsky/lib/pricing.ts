/**
 * THE CHANNEL PRICE: marketplace prices are gross (the SDK's `PriceTag`
 * carries `gross_price`). From the Medusa PLN price: VAT added when Medusa
 * keeps prices without tax, then the channel markup in percent, rounded to
 * the grosz. A per-offer override (a fixed gross price) wins over both.
 *
 * Everything in minor units (grosze); Medusa v2 keeps prices in major units,
 * so the reader converts with `toMinor` first.
 */

export interface PriceInput {
  baseMinor: number | null
  /** Whether the base already includes VAT. */
  includesTax: boolean
  vatRate: number
  markupPercent: number
  overrideMinor: number | null
}

/** 49.99 -> 4999. Null for anything that is not a finite number. */
export function toMinor(amount: unknown): number | null {
  const n = typeof amount === "number" ? amount : typeof amount === "string" && amount.trim() ? Number(amount) : NaN
  if (!Number.isFinite(n)) return null
  return Math.round(Number((n * 100).toFixed(4)))
}

/** 4999 -> "49.99". */
export function fromMinor(minor: number | null | undefined): string | null {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return null
  return (minor / 100).toFixed(2)
}

export function channelPriceMinor(p: PriceInput): number | null {
  if (p.overrideMinor !== null && Number.isFinite(p.overrideMinor) && p.overrideMinor > 0) return Math.round(p.overrideMinor)
  if (p.baseMinor === null || !Number.isFinite(p.baseMinor) || p.baseMinor <= 0) return null
  const gross = p.includesTax ? p.baseMinor : p.baseMinor * (1 + p.vatRate / 100)
  const priced = gross * (1 + p.markupPercent / 100)
  return Math.max(1, Math.round(Number(priced.toFixed(4))))
}

/** A markup typed in the admin: a number from -50 to 300, or null when it is not one. */
export function parseMarkup(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(typeof value === "string" ? value.replace(",", ".") : value)
  if (!Number.isFinite(n) || n < -50 || n > 300) return null
  return Math.round(n * 100) / 100
}

/** A price override typed in the admin ("129,99", 129.99), as minor units; null clears it, undefined is invalid. */
export function parseOverride(value: unknown): number | null | undefined {
  if (value === null || value === "") return null
  const n = Number(typeof value === "string" ? value.replace(",", ".").replace(/\s/g, "") : value)
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return undefined
  return Math.round(Number((n * 100).toFixed(4)))
}
