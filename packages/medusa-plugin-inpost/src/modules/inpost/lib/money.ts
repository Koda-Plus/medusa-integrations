/**
 * MONEY IN GROSZE. Zero imports.
 *
 * A cash on delivery amount is what the courier or the locker takes from the
 * customer, so it must be exactly the order total, to the grosz. Medusa hands
 * totals over in several shapes: a number (sometimes with float noise, like
 * 1565.0043 from a B2B price list, or 1.005), a decimal string, or a
 * BigNumber-like object (`{ value: "199.99" }`, `{ numeric: 199.99 }`).
 * Everything is turned into an integer number of grosze through decimal
 * strings, rounded half up at the second decimal, and only then into the
 * number ShipX takes (`199.99`) or the string events carry ("199.99").
 */

/** A decimal string ("1565.0043", "-12.5", "7") from the shapes Medusa uses, or null. */
export function decimalString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    /* toFixed(10) reads the exact binary value: 1.005 becomes "1.0050000000", not "1.00". */
    return value.toFixed(10)
  }
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "string") {
    const s = value.trim().replace(",", ".")
    return /^-?\d+(\.\d+)?$/.test(s) ? s : null
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>
    if ("value" in v) return decimalString(v.value)
    if ("numeric" in v) return decimalString(v.numeric)
    if ("raw" in v) return decimalString(v.raw)
    if (typeof (v as { toString?: unknown }).toString === "function") {
      const s = String(value)
      if (s !== "[object Object]") return decimalString(s)
    }
  }
  return null
}

/** Integer grosze, rounded half up (away from zero), or null when the value is not a number. */
export function toMinor(value: unknown): number | null {
  const s = decimalString(value)
  if (s === null) return null
  const negative = s.startsWith("-")
  const [int, frac = ""] = (negative ? s.slice(1) : s).split(".")
  const cents = Number(int) * 100 + Number((frac + "00").slice(0, 2))
  const roundUp = Number((frac + "000").charAt(2)) >= 5
  const minor = cents + (roundUp ? 1 : 0)
  if (!Number.isSafeInteger(minor)) return null
  return negative ? -minor : minor
}

/** "199.99" from 19999. */
export function formatMinor(minor: number): string {
  const negative = minor < 0
  const abs = Math.abs(Math.trunc(minor))
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
  return negative ? `-${s}` : s
}

/** The number ShipX takes (199.99) from grosze. JSON prints it as written. */
export function minorToAmount(minor: number): number {
  return Number(formatMinor(minor))
}

/**
 * The first usable amount of a list of candidates (the order summary first,
 * then the order total), in grosze. Undefined, null and broken values are
 * skipped; zero counts as a value.
 */
export function firstMinor(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const m = toMinor(c)
    if (m !== null) return m
  }
  return null
}
