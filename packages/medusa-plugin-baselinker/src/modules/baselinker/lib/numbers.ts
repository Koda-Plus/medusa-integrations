/**
 * Numbers coming out of Medusa: plain numbers, numeric strings, or BigNumber
 * objects (computed totals carry `numeric` and serialize through `toJSON`).
 * Everything ends up as a plain number in major units. Zero imports.
 */

export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const n = Number(value)
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
    const n = Number(value.trim())
    return value.trim() !== "" && Number.isFinite(n) ? n : null
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
