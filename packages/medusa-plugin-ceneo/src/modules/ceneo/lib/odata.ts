/**
 * THE ODATA BITS OF THE CENEO API (BasketService.svc, OData v2 JSON). Pure.
 *
 * The answers differ per method (Swagger examples): `{ d: { results: [] } }`
 * for lists, `{ d: [] }` for some dictionaries, `{ d: {} }` for one entity.
 * `$filter` is built only from a whitelist of fields and operators, with
 * typed values: nothing a caller passes reaches the query as text.
 */

export function odataList(body: unknown): Record<string, unknown>[] {
  const isRow = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v)
  if (!isRow(body)) return Array.isArray(body) ? body.filter(isRow) : []
  const d = "d" in body ? body.d : "value" in body ? body.value : body
  if (Array.isArray(d)) return d.filter(isRow)
  if (isRow(d)) {
    if (Array.isArray(d.results)) return d.results.filter(isRow)
    return [d]
  }
  return []
}

export function odataOne(body: unknown): Record<string, unknown> | null {
  return odataList(body)[0] ?? null
}

/* ---- dates: Ceneo sends local Polish time without an offset -------- */

const ZONE = "Europe/Warsaw"

/** Offset of Warsaw from UTC at the instant `utcMs`, in minutes (60 or 120). */
function warsawOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs))
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"))
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000)
}

/**
 * A Ceneo date: `2022-01-05T10:20:30` (Warsaw time), with an offset or `Z`
 * when given, or the OData v2 `/Date(1641374430000)/`. Null when unreadable.
 */
export function parseCeneoDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v.trim()) return null
  const s = v.trim()
  const ms = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(s)
  if (ms) return new Date(Number(ms[1]))
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s)
  if (!m) return null
  if (m[8]) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const frac = m[7] ? Number(`0.${m[7]}`) * 1000 : 0
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0), Math.round(frac))
  /* Two passes settle the offset around the DST change. */
  let utc = wall - warsawOffsetMinutes(wall) * 60_000
  utc = wall - warsawOffsetMinutes(utc) * 60_000
  return new Date(utc)
}

/** A Date as the Warsaw wall time Ceneo compares with: `2026-11-11T13:00:00`. */
export function toCeneoWallTime(d: Date): string {
  const local = new Date(d.getTime() + warsawOffsetMinutes(d.getTime()) * 60_000)
  return local.toISOString().slice(0, 19)
}

/* ---- $filter from a whitelist -------------------------------------- */

export type OrderFilter = { createdFrom?: Date; createdTo?: Date; stateId?: number }

/** `$filter` for BasketService Orders; only these fields and operators exist. */
export function ordersFilter(f: OrderFilter): string | null {
  const parts: string[] = []
  if (f.createdFrom) parts.push(`CreatedDate ge datetime'${toCeneoWallTime(f.createdFrom)}'`)
  if (f.createdTo) parts.push(`CreatedDate lt datetime'${toCeneoWallTime(f.createdTo)}'`)
  if (f.stateId !== undefined) {
    if (!Number.isInteger(f.stateId) || f.stateId < 0) throw new Error("stateId must be a non negative integer.")
    parts.push(`OrderStateId eq ${f.stateId}`)
  }
  return parts.length > 0 ? parts.join(" and ") : null
}

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function isGuid(v: unknown): v is string {
  return typeof v === "string" && GUID.test(v)
}

/**
 * The token from `GetToken`. The Swagger shows no example, so every shape
 * an OData service may give is read: a bare string, a JSON string,
 * `{ d: "..." }`, `{ d: { GetToken: "..." } }`, `{ access_token }`, `{ Token }`.
 */
export function parseToken(text: string): string | null {
  const raw = text.trim()
  if (!raw) return null
  let v: unknown = raw
  try {
    v = JSON.parse(raw)
  } catch {
    /* a bare token */
  }
  const pick = (x: unknown, depth = 0): string | null => {
    if (typeof x === "string") return /^[A-Za-z0-9._~+/=-]{16,}$/.test(x.trim()) ? x.trim() : null
    if (!x || typeof x !== "object" || depth > 2) return null
    const o = x as Record<string, unknown>
    for (const k of ["access_token", "AccessToken", "Token", "token", "GetToken", "d"]) {
      if (k in o) {
        const found = pick(o[k], depth + 1)
        if (found) return found
      }
    }
    return null
  }
  return pick(v)
}
