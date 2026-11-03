/**
 * The dates of a coupon with an optional time (HH:MM), in the store's time
 * zone (option timeZone, e.g. "Europe/Warsaw"; without it the admin's own
 * zone). Pure: no Medusa imports, so the creator, the edit form, the
 * sentence and the tests agree.
 *
 * A day without a time keeps its old meaning: from the first millisecond of
 * the day (start) to its last one (end), so "until 4 Nov" still means the
 * end of 4 November in the store's zone. A time typed by hand is a whole
 * minute (seconds and milliseconds 0); that is how the sentence knows it is
 * worth saying. The presets ("30 days", "until the end of the month") start
 * at the moment of saving and never read as a time.
 */

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export type Edge = "start" | "end"

/** The zone if Intl knows it, else undefined (the runtime's own zone). */
export function cleanZone(zone: unknown): string | undefined {
  if (typeof zone !== "string" || !zone.trim()) return undefined
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone.trim() })
    return zone.trim()
  } catch {
    return undefined
  }
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number; ms: number }

/** The wall clock of an instant in a zone (undefined: the runtime's zone). */
export function wallOf(ms: number, zone?: string): Wall {
  const date = new Date(ms)
  const milli = ((ms % 1000) + 1000) % 1000
  if (!zone) return { y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), mi: date.getMinutes(), s: date.getSeconds(), ms: milli }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour") % 24, mi: n("minute"), s: n("second"), ms: milli }
}

/** The instant of a wall clock time in a zone (DST: the first such instant). */
export function zonedMs(w: Wall, zone?: string): number {
  if (!zone) return new Date(w.y, w.mo - 1, w.d, w.h, w.mi, w.s, w.ms).getTime()
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s, w.ms)
  const offsetAt = (t: number) => {
    const x = wallOf(t, zone)
    return Date.UTC(x.y, x.mo - 1, x.d, x.h, x.mi, x.s, x.ms) - t
  }
  const first = offsetAt(guess)
  let out = guess - first
  const second = offsetAt(out)
  if (second !== first) out = guess - second
  return out
}

/**
 * A day of the form (YYYY-MM-DD) and an optional time (HH:MM) as an exact
 * ISO moment. No time: the start of the day for "start", its last
 * millisecond for "end". Null for an empty or broken day.
 */
export function edgeIso(day: string | null | undefined, time: string | null | undefined, edge: Edge, zone?: string | null): string | null {
  const d = String(day ?? "").trim()
  if (!DAY_PATTERN.test(d)) return null
  const [y, mo, dd] = d.split("-").map(Number)
  const t = typeof time === "string" && TIME_PATTERN.test(time.trim()) ? time.trim() : null
  const [h, mi] = t ? t.split(":").map(Number) : edge === "start" ? [0, 0] : [23, 59]
  const tail = t || edge === "start" ? { s: 0, ms: 0 } : { s: 59, ms: 999 }
  const ms = zonedMs({ y, mo, d: dd, h, mi, ...tail }, cleanZone(zone))
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

const pad = (n: number) => String(n).padStart(2, "0")

/**
 * An ISO moment as the form's day and time in the zone. `time` is null when
 * it says nothing: the default of the edge (start 00:00, end 23:59:59.999)
 * or not a whole minute (a preset that started "now").
 */
export function edgeParts(iso: string | null | undefined, edge: Edge, zone?: string | null): { day: string; time: string | null } | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return null
  const z = cleanZone(zone)
  /* Older creators sent the day without a zone and the server (UTC) kept it as a UTC day: read it as that day. */
  const u = wallOf(ms, "UTC")
  const legacy = z && z !== "UTC" && (edge === "start" ? u.h === 0 && u.mi === 0 && u.s === 0 && u.ms === 0 : u.h === 23 && u.mi === 59 && u.s === 59)
  const w = legacy ? { ...u, h: edge === "start" ? 0 : 23, mi: edge === "start" ? 0 : 59, s: edge === "start" ? 0 : 59 } : wallOf(ms, z)
  const day = `${w.y}-${pad(w.mo)}-${pad(w.d)}`
  const whole = w.s === 0 && w.ms === 0
  const isDefault = edge === "start" ? w.h === 0 && w.mi === 0 && whole : w.h === 23 && w.mi === 59 && w.s === 59
  return { day, time: whole && !isDefault ? `${pad(w.h)}:${pad(w.mi)}` : null }
}

/** Just the time worth saying ("10:00"), or null (see edgeParts). */
export function edgeTime(iso: string | null | undefined, edge: Edge, zone?: string | null): string | null {
  return edgeParts(iso, edge, zone)?.time ?? null
}
