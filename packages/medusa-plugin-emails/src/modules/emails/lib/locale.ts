/**
 * LANGUAGE AND FORMATS of a message. Zero imports from Medusa.
 *
 * The language of an e-mail is picked per recipient, from the first of
 * these that names a supported language: the order's `locale` (Medusa 2.12+,
 * a BCP 47 tag such as "pl-PL"), `locale` or `language` in the order's,
 * cart's or customer's metadata, then the `defaultLocale` option. Only the
 * primary subtag counts: "pl-PL", "pl_PL" and "PL" are all Polish.
 *
 * Amounts arrive the way Medusa returns them (numbers in major units,
 * numeric strings, or BigNumber shapes) and are formatted in the language of
 * the message with the order's currency; dates in the store's time zone.
 */

import { LOCALES, type EmailLocale } from "./constants"

/** The supported language a tag or a word names, or null: "pl-PL", "pl_PL", "PL", "polish" are all "pl". */
export function normalizeLocale(value: unknown): EmailLocale | null {
  if (typeof value !== "string") return null
  const s = value.trim().toLowerCase()
  if (!s) return null
  if (s === "polish" || s === "polski") return "pl"
  if (s === "english") return "en"
  const primary = s.split(/[-_]/)[0]
  return (LOCALES as readonly string[]).includes(primary) ? (primary as EmailLocale) : null
}

/** The first candidate that names a supported language, or the fallback. */
export function pickLocale(candidates: readonly unknown[], fallback: EmailLocale): EmailLocale {
  for (const c of candidates) {
    const l = normalizeLocale(c)
    if (l) return l
  }
  return fallback
}

/** `locale`, `language` or `lang` of a metadata object. */
export function metadataLocale(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== "object") return null
  const m = metadata as Record<string, unknown>
  return m.locale ?? m.language ?? m.lang ?? null
}

const DEFAULT_TAGS: Record<EmailLocale, string> = { pl: "pl-PL", en: "en-GB" }

/**
 * The Intl tag of a message: the recipient's own tag when it is in the same
 * language (en-US keeps US formats), otherwise Polish from Poland and British
 * English (day month year, the order European shoppers expect).
 */
export function formatTag(locale: EmailLocale, original?: unknown): string {
  if (typeof original === "string" && normalizeLocale(original) === locale && /^[a-z]{2}[-_][A-Za-z]{2}$/.test(original.trim())) {
    const tag = original.trim().replace("_", "-")
    try {
      new Intl.NumberFormat(tag)
      return tag
    } catch {
      /* fall through */
    }
  }
  return DEFAULT_TAGS[locale]
}

/** A number from what Medusa returns: a number, a numeric string, or `{ numeric }` / `{ value }` (BigNumber). */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const n = Number(value.trim())
    return Number.isFinite(n) ? n : null
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>
    if (typeof o.numeric === "number" && Number.isFinite(o.numeric)) return o.numeric
    if ("value" in o) return toNumber(o.value)
    try {
      const n = Number(value as unknown as number)
      return Number.isFinite(n) ? n : null
    } catch {
      return null
    }
  }
  return null
}

/** A three-letter currency code, upper case, or null. */
export function currencyCode(value: unknown): string | null {
  if (typeof value !== "string") return null
  const s = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(s) ? s : null
}

/** An amount ready to read: a string stays as it is, a number is formatted with the currency (or plainly without one). */
export function formatMoney(value: unknown, currency: unknown, tag: string): string {
  if (typeof value === "string" && value.trim() && toNumber(value) === null) return value.trim()
  const n = toNumber(value)
  if (n === null) return ""
  const code = currencyCode(currency)
  try {
    if (code) return new Intl.NumberFormat(tag, { style: "currency", currency: code }).format(n)
    return new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  } catch {
    return `${n.toFixed(2)}${code ? ` ${code}` : ""}`
  }
}

export function formatNumber(value: unknown, tag: string): string {
  const n = toNumber(value)
  if (n === null) return ""
  try {
    return new Intl.NumberFormat(tag, { maximumFractionDigits: 3 }).format(n)
  } catch {
    return String(n)
  }
}

/** Whether Intl knows the time zone ("Europe/Warsaw", "UTC"). */
export function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false
  try {
    new Intl.DateTimeFormat("en", { timeZone: value.trim() })
    return true
  } catch {
    return false
  }
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value)
    return Number.isFinite(d.getTime()) ? d : null
  }
  return null
}

/**
 * A date (and optionally the time) in the language of the message and the
 * store's time zone: "6 października 2026, 14:32", "6 October 2026, 14:32".
 * A string that is not a date is shown as it is.
 */
export function formatDate(value: unknown, tag: string, timeZone: string, withTime = false): string {
  const d = asDate(value)
  if (!d) return typeof value === "string" ? value.trim() : ""
  try {
    const date = new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", year: "numeric", timeZone }).format(d)
    if (!withTime) return date
    const time = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d)
    return `${date}, ${time}`
  } catch {
    return d.toISOString().slice(0, withTime ? 16 : 10).replace("T", " ")
  }
}

/** A short date for narrow places (the order tracker): "6 paź, 14:32", "6 Oct, 14:32". */
export function formatShortDate(value: unknown, tag: string, timeZone: string, withTime = false): string {
  const d = asDate(value)
  if (!d) return typeof value === "string" ? value.trim() : ""
  try {
    const date = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone }).format(d).replace(/\.$/, "")
    if (!withTime) return date
    const time = new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d)
    return `${date}, ${time}`
  } catch {
    return d.toISOString().slice(5, withTime ? 16 : 10).replace("T", " ")
  }
}

/** Month and year the way a card shows them: 10/2026. */
export function monthYear(value: unknown, timeZone: string): string {
  const d = asDate(value)
  if (!d) return ""
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { month: "2-digit", year: "numeric", timeZone }).formatToParts(d)
    const month = parts.find((p) => p.type === "month")?.value ?? ""
    const year = parts.find((p) => p.type === "year")?.value ?? ""
    return month && year ? `${month}/${year}` : ""
  } catch {
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`
  }
}

/**
 * Plural forms. Polish has three: 1 pozycja, 2 to 4 pozycje (also 22, 23,
 * 24, but not 12 to 14), 5 and more pozycji. English has two.
 */
export function plural(locale: EmailLocale, n: number, forms: { one: string; few: string; many: string }): string {
  const abs = Math.abs(Math.trunc(n))
  if (abs === 1) return forms.one
  if (locale === "en") return forms.many
  const d = abs % 10
  const t = abs % 100
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? forms.few : forms.many
}
