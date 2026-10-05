/**
 * Numbers coming out of Medusa and Fakturownia: plain numbers, numeric
 * strings ("123.45" from the API, "123,45" typed by a person), or BigNumber
 * objects (Medusa computed totals carry `numeric` and serialize through
 * `toJSON`). Everything ends up as a plain number in major units. Zero imports.
 */

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const n = Number(value.trim().replace(",", "."))
    return Number.isFinite(n) ? n : 0
  }
  if (value && typeof value === "object") {
    const v = value as { numeric?: unknown; value?: unknown; toJSON?: () => unknown }
    if (typeof v.numeric === "number") return toNumber(v.numeric)
    if (v.value !== undefined) return toNumber(v.value)
    if (typeof v.toJSON === "function") return toNumber(v.toJSON())
  }
  return 0
}

/** A number when the value is one, `null` when it is missing or not numeric. */
export function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    const t = value.trim().replace(",", ".")
    const n = Number(t)
    return t !== "" && Number.isFinite(n) ? n : null
  }
  if (typeof value === "object") {
    const n = toNumber(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Rounds half away from zero, without the binary float surprises of `toFixed`. */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** decimals
  const shifted = Math.abs(value) * factor
  const rounded = Math.round(shifted + Number.EPSILON * shifted) / factor
  return value < 0 ? -rounded : rounded
}

export function money(value: unknown): number {
  return round(toNumber(value), 2)
}

/** "123.40": the amount format Fakturownia shows and accepts. */
export function amountText(value: number): string {
  return round(value, 2).toFixed(2)
}

/** Two amounts are the same when they differ by less than `tolerance` (default half a cent). */
export function sameAmount(a: number | null | undefined, b: number | null | undefined, tolerance = 0.005): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false
  return Math.abs(a - b) <= tolerance + Number.EPSILON
}
