/**
 * MONEY, EXACT. Pure: no Medusa import, tested with `node --test`.
 *
 * Every amount of this module is an integer in the minor unit of its
 * currency: 469.00 PLN is 46900, 38.50 EUR is 3850, 1200 JPY is 1200. No
 * floating point ever touches an amount: input is parsed from its decimal
 * text, output is formatted back into decimal text, and a line value is an
 * integer product. Each thread keeps its currency code next to the amounts.
 *
 * The number of decimals comes from the currency (ISO 4217, read through
 * Intl: 2 for PLN, EUR and USD, 0 for JPY, 3 for KWD), 2 when Intl does not
 * know the code.
 *
 * Why not Medusa's `bigNumber`: it needs a second `raw_` column for every
 * field, and the Koda Plus plugins keep their tables plain. An integer
 * column holds unit prices up to 20 000 000.00 in a two-decimal currency
 * (`MAX_AMOUNT`); larger input is refused, never wrapped.
 */

import { MAX_AMOUNT } from "./constants"

const DIGITS_CACHE = new Map<string, number>()

/** Lower-case three-letter code, as Medusa keeps currency codes, or null. */
export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null
  const s = value.trim().toLowerCase()
  return /^[a-z]{3}$/.test(s) ? s : null
}

/** Decimals of a currency: 2 for PLN, 0 for JPY, 3 for KWD; 2 for an unknown code. */
export function currencyDigits(code: string | null | undefined): number {
  const c = normalizeCurrency(code)
  if (!c) return 2
  const cached = DIGITS_CACHE.get(c)
  if (cached !== undefined) return cached
  let digits = 2
  try {
    const d = new Intl.NumberFormat("en", { style: "currency", currency: c.toUpperCase() }).resolvedOptions().maximumFractionDigits
    if (typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 4) digits = d
  } catch {
    digits = 2
  }
  DIGITS_CACHE.set(c, digits)
  return digits
}

export type AmountError = "required" | "invalid" | "not_positive" | "too_many_decimals" | "too_large"
export type AmountResult = { ok: true; amount: number } | { ok: false; error: AmountError }

/**
 * A price typed by a person or sent by a storefront, as minor units.
 *
 *   "469", "469.00", "469,00", 469 and 469.5 are accepted;
 *   "1 234,50", "1,234.50" (thousand separators), "-5", "0", "abc",
 *   1e21 and more decimals than the currency has are refused.
 *
 * Extra decimals that are all zero ("12.500" for PLN) are fine. A number is
 * read through its shortest decimal text, so 0.1 + 0.2 (0.30000000000000004)
 * is refused instead of rounded: send prices as strings.
 */
export function parseAmount(input: unknown, digits: number): AmountResult {
  if (input === undefined || input === null || input === "") return { ok: false, error: "required" }
  let text: string
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { ok: false, error: "invalid" }
    if (input <= 0) return { ok: false, error: "not_positive" }
    text = String(input)
    if (/e/i.test(text)) return { ok: false, error: input >= 1 ? "too_large" : "too_many_decimals" }
  } else if (typeof input === "string") {
    text = input.trim()
  } else {
    return { ok: false, error: "invalid" }
  }
  if (text === "") return { ok: false, error: "required" }
  if (/^-/.test(text)) return { ok: false, error: "not_positive" }
  /* One comma as the decimal separator, the Polish way, when there is no dot. */
  if (!text.includes(".") && (text.match(/,/g) ?? []).length === 1) text = text.replace(",", ".")
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text)
  if (!m) return { ok: false, error: "invalid" }
  const whole = m[1].replace(/^0+(?=\d)/, "")
  let fraction = m[2] ?? ""
  if (fraction.length > digits) {
    if (/[^0]/.test(fraction.slice(digits))) return { ok: false, error: "too_many_decimals" }
    fraction = fraction.slice(0, digits)
  }
  if (whole.length > 12) return { ok: false, error: "too_large" }
  const amount = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0")
  if (!Number.isSafeInteger(amount)) return { ok: false, error: "too_large" }
  if (amount <= 0) return { ok: false, error: "not_positive" }
  if (amount > MAX_AMOUNT) return { ok: false, error: "too_large" }
  return { ok: true, amount }
}

/** Minor units as decimal text: 46900 with 2 digits is "469.00", 5 is "0.05", 1200 with 0 digits is "1200". */
export function formatAmount(amount: number, digits: number): string {
  if (!Number.isSafeInteger(amount)) return "0"
  const negative = amount < 0
  const abs = String(Math.abs(amount))
  if (digits <= 0) return `${negative ? "-" : ""}${abs}`
  const padded = abs.padStart(digits + 1, "0")
  const whole = padded.slice(0, padded.length - digits)
  const fraction = padded.slice(padded.length - digits)
  return `${negative ? "-" : ""}${whole}.${fraction}`
}

/** Minor units as decimal text, or null for no amount. */
export function formatOrNull(amount: number | null | undefined, digits: number): string | null {
  return typeof amount === "number" && Number.isSafeInteger(amount) ? formatAmount(amount, digits) : null
}

/**
 * An amount as Medusa returns it (a number in major units, a numeric string,
 * or a BigNumber shape such as `{ value: "12.5" }` or `{ numeric: 12.5 }`) in
 * minor units, rounded half up to the currency's decimals. Null for anything
 * that is not a finite, non-negative amount.
 */
export function amountFromMedusa(value: unknown, digits: number): number | null {
  let v: unknown = value
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>
    v = o.value ?? o.numeric ?? o.amount ?? null
  }
  let text: string
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return null
    text = /e/i.test(String(v)) ? v.toFixed(Math.min(20, digits + 6)) : String(v)
  } else if (typeof v === "string") {
    text = v.trim()
  } else {
    return null
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text)
  if (!m) return null
  const whole = m[1]
  const fraction = m[2] ?? ""
  if (whole.length > 13) return null
  const kept = fraction.slice(0, digits).padEnd(digits, "0")
  const next = fraction.length > digits ? Number(fraction[digits]) : 0
  let amount = Number(whole) * 10 ** digits + Number(kept || "0")
  if (next >= 5) amount += 1
  return Number.isSafeInteger(amount) ? amount : null
}

/** Minor units as a number in major units, for an API that takes one (Medusa unit prices). */
export function toMajorNumber(amount: number, digits: number): number {
  return Number(formatAmount(amount, digits))
}

/** quantity times a unit amount, or null when it would not stay an exact integer. */
export function multiply(amount: number | null | undefined, quantity: number): number | null {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || !Number.isSafeInteger(quantity)) return null
  const product = amount * quantity
  return Number.isSafeInteger(product) ? product : null
}

/**
 * How far below the list price a price is, in percent with one decimal:
 * list 549.00, price 469.00 is 14.6. Null without both, or for a zero list.
 */
export function percentBelow(list: number | null | undefined, price: number | null | undefined): number | null {
  if (typeof list !== "number" || typeof price !== "number" || list <= 0) return null
  return Math.round(((list - price) / list) * 1000) / 10
}

/** Amounts per currency, added only within one currency. */
export function sumByCurrency(items: ReadonlyArray<{ currency: string | null; amount: number | null }>): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>()
  for (const i of items) {
    if (!i.currency || typeof i.amount !== "number" || !Number.isSafeInteger(i.amount)) continue
    const next = (totals.get(i.currency) ?? 0) + i.amount
    if (Number.isSafeInteger(next)) totals.set(i.currency, next)
  }
  return [...totals.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount || (a.currency < b.currency ? -1 : 1))
}

/**
 * A round price near `amount * factor`, the way people quote: whole units
 * from 100 up, halves from 10, tenths below (in a two-decimal currency).
 * For the demo story only.
 */
export function roundPrice(amount: number, factor: number, digits: number): number {
  const raw = Math.max(1, Math.round(amount * factor))
  const unit = 10 ** digits
  const step = raw >= 100 * unit ? unit : raw >= 10 * unit ? Math.max(1, unit / 2) : Math.max(1, unit / 10)
  return Math.max(step, Math.round(raw / step) * step)
}
