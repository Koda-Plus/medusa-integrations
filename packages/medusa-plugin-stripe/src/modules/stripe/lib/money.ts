/**
 * MONEY IN MINOR UNITS. No runtime imports: the admin bundle formats with it
 * and the unit tests load it without a build.
 *
 * Stripe sends every amount as an integer in the currency's smallest unit
 * (grosze for PLN, cents for EUR, yen for JPY). The plugin keeps it that way:
 * sums are integer sums per currency, never floats, and two currencies are
 * never added together. Only the last step, formatting for a person, turns
 * the integer into a decimal string (by moving the decimal point, without a
 * division) and hands that string to Intl.
 */
import type { MoneyDto } from "./contract"

/** Stripe's zero-decimal currencies: the amount is in whole units. */
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"])

/** Stripe's three-decimal currencies. */
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"])

/** Digits after the decimal point in Stripe's amounts for this currency (2 for PLN and EUR). */
export function currencyExponent(currency: string): number {
  const c = String(currency ?? "").toLowerCase()
  if (ZERO_DECIMAL.has(c)) return 0
  if (THREE_DECIMAL.has(c)) return 3
  return 2
}

/** A valid amount in minor units: a safe integer. */
export function isMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
}

/** Money from Stripe's fields, or null when the amount is not an integer or the currency is missing. */
export function money(amount: unknown, currency: unknown): MoneyDto | null {
  if (!isMinor(amount)) return null
  const c = typeof currency === "string" ? currency.trim().toLowerCase() : ""
  if (!/^[a-z]{3}$/.test(c)) return null
  return { amount, currency: c }
}

/**
 * Per-currency integer sums. `add` refuses anything that is not a safe
 * integer, so a float can never sneak into a total.
 */
export class MoneyBag {
  private readonly sums = new Map<string, number>()

  add(value: MoneyDto | null | undefined, sign: 1 | -1 = 1): this {
    if (!value || !isMinor(value.amount)) return this
    const c = value.currency.toLowerCase()
    const next = (this.sums.get(c) ?? 0) + sign * value.amount
    if (!Number.isSafeInteger(next)) throw new RangeError(`Amount out of range in ${c}`)
    this.sums.set(c, next)
    return this
  }

  addAll(values: ReadonlyArray<MoneyDto | null | undefined>): this {
    for (const v of values) this.add(v)
    return this
  }

  get size(): number {
    return this.sums.size
  }

  amountOf(currency: string): number {
    return this.sums.get(currency.toLowerCase()) ?? 0
  }

  /** The largest amount first, then by currency; zero sums are kept (a currency that was used). */
  list(): MoneyDto[] {
    return [...this.sums.entries()]
      .map(([currency, amount]) => ({ amount, currency }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.currency.localeCompare(b.currency))
  }
}

export function sumMoney(values: ReadonlyArray<MoneyDto | null | undefined>): MoneyDto[] {
  return new MoneyBag().addAll(values).list()
}

/** 12345 PLN as "123.45", -5 PLN as "-0.05", 500 JPY as "500". Moves the decimal point, never divides. */
export function minorToDecimal(amount: number, currency: string): string {
  if (!isMinor(amount)) return "0"
  const exp = currencyExponent(currency)
  const negative = amount < 0
  const digits = String(Math.abs(amount))
  if (exp === 0) return `${negative ? "-" : ""}${digits}`
  const padded = digits.padStart(exp + 1, "0")
  return `${negative ? "-" : ""}${padded.slice(0, padded.length - exp)}.${padded.slice(padded.length - exp)}`
}

/** "1 234,56 zł" in Polish, "PLN 1,234.56" in English: Intl with the exact decimal string. */
export function formatMoney(amount: number, currency: string, lang: string): string {
  const code = String(currency ?? "").toUpperCase()
  const exp = currencyExponent(currency)
  const decimal = minorToDecimal(amount, currency)
  try {
    const nf = new Intl.NumberFormat(lang || "en", { style: "currency", currency: code, minimumFractionDigits: exp, maximumFractionDigits: exp })
    /* Modern engines format a numeric string exactly (Intl.NumberFormat v3); older ones convert it to a number, which is fine for display. */
    return nf.format(decimal as unknown as number)
  } catch {
    return `${decimal} ${code}`.trim()
  }
}

/** Amounts in several currencies, side by side, never added: "1 234,56 zł, 12,00 €". */
export function formatMoneyList(values: readonly MoneyDto[], lang: string, empty = ""): string {
  if (values.length === 0) return empty
  return values.map((m) => formatMoney(m.amount, m.currency, lang)).join(", ")
}

/**
 * A decimal string from what Medusa hands over: a number, a numeric string,
 * or a BigNumber (whose `raw.value` is the exact decimal). Null otherwise.
 */
export function decimalString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") {
    const s = value.trim().replace(",", ".")
    return /^-?\d+(\.\d+)?$/.test(s) ? s : null
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    const s = String(value)
    if (!/e/i.test(s)) return s
    return Math.abs(value) < 1e-6 ? "0" : null
  }
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "object") {
    const v = value as { raw?: { value?: unknown } | null; numeric?: unknown; value?: unknown; toJSON?: () => unknown }
    const raw = v.raw && typeof v.raw === "object" ? decimalString(v.raw.value) : null
    if (raw !== null) return raw
    if (typeof v.numeric === "number") return decimalString(v.numeric)
    if (v.value !== undefined && v.value !== value) return decimalString(v.value)
    if (typeof v.toJSON === "function") {
      try {
        return decimalString(v.toJSON())
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * A decimal amount in major units (Medusa's totals) as an integer in minor
 * units, rounded half away from zero on the first dropped digit: "199.995"
 * PLN is 20000. Works on the digits of the string, so 0.1 + 0.2 style float
 * errors never reach the result.
 */
export function toMinor(value: unknown, currency: string): number | null {
  const s = decimalString(value)
  if (s === null) return null
  const exp = currencyExponent(currency)
  const negative = s.startsWith("-")
  const [intPart = "0", fracPart = ""] = s.replace(/^-/, "").split(".")
  const frac = fracPart.padEnd(exp + 1, "0")
  const kept = frac.slice(0, exp)
  const next = Number(frac.charAt(exp) || "0")
  let minor = Number(`${intPart}${kept}`.replace(/^0+(?=\d)/, ""))
  if (!Number.isSafeInteger(minor)) return null
  if (next >= 5) minor += 1
  if (minor === 0) return 0
  return negative ? -minor : minor
}

/** A share of a whole, 0 to 1, for display only; null when the whole is zero. */
export function share(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return null
  return part / whole
}

/** Basis points of an amount, rounded to the nearest minor unit (demo fees). Integer in, integer out. */
export function basisPoints(amount: number, bps: number): number {
  if (!isMinor(amount) || !Number.isFinite(bps)) return 0
  return Math.round((amount * bps) / 10_000)
}
