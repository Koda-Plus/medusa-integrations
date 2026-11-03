import { POINT_TYPES } from "../../modules/dpd/lib/constants"
import type { PlanDto, PointDto, PointHoursDto, PointLimitsDto, ProblemDto, ShipmentDto, WriterDto, WriterKey } from "../../modules/dpd/lib/contract"

/**
 * The plain logic of the admin: no React, no kit, no DOM, so `node --test`
 * loads it (the .tsx files around it it cannot). Errors of the admin API,
 * money, the refused fields of the boxes, the writers, the label file and
 * the DPD Pickup points.
 */

export class DpdRequestError extends Error {
  readonly status: number
  readonly code: string | null
  /** The JSON body of the answer, null when it was not JSON (the boxes route lists its refused fields here). */
  readonly body: unknown
  /** point_refused: the problems of the chosen point, from the body; empty for any other answer. */
  readonly problems: ProblemDto[]
  constructor(status: number, message: string, code: string | null, body: unknown = null) {
    super(message)
    this.name = "DpdRequestError"
    this.status = status
    this.code = code
    this.body = body
    this.problems = problemsOfBody(body)
  }
}

/**
 * The `problems` of an error body (ErrorResponse): each entry with a code,
 * its field and detail when they are strings, `source` only when it is
 * "dpd". Entries of another shape are left out.
 */
export function problemsOfBody(body: unknown): ProblemDto[] {
  if (!body || typeof body !== "object") return []
  const list = (body as { problems?: unknown }).problems
  if (!Array.isArray(list)) return []
  const out: ProblemDto[] = []
  for (const p of list) {
    if (!p || typeof p !== "object") continue
    const { code, field, detail, source } = p as { code?: unknown; field?: unknown; detail?: unknown; source?: unknown }
    if (typeof code !== "string" || !code) continue
    out.push({
      code,
      ...(typeof field === "string" ? { field } : {}),
      ...(typeof detail === "string" ? { detail } : {}),
      ...(source === "dpd" ? { source: "dpd" as const } : {}),
    })
  }
  return out
}

/** The JSON of an answer's text, or null. */
export function parseJson(text: string): unknown {
  try {
    return text ? (JSON.parse(text) as unknown) : null
  } catch {
    return null
  }
}

/** The error of an answer that is not ok: the server's code and message from its JSON body (ErrorResponse). */
export function requestError(status: number, text: string): DpdRequestError {
  const json = parseJson(text)
  const body = (json && typeof json === "object" ? json : {}) as { message?: unknown; code?: unknown }
  return new DpdRequestError(status, typeof body.message === "string" ? body.message : `HTTP ${status}`, typeof body.code === "string" ? body.code : null, json)
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/** "199.99" and "PLN" in the admin's format: "199,99 zł" or "PLN 199.99". */
export function fmtMoney(amount: string | null | undefined, currency: string | null | undefined, lang: string): string {
  if (amount === null || amount === undefined || amount === "") return ""
  const n = Number(amount)
  if (!Number.isFinite(n)) return amount
  try {
    return new Intl.NumberFormat(lang, { style: "currency", currency: (currency || "PLN").toUpperCase() }).format(n)
  } catch {
    return `${amount} ${currency ?? ""}`.trim()
  }
}

/**
 * An amount in minor units (grosze, cents) in the admin's format: 12345 PLN
 * is "123,45 zł" in Polish. Minor units are always hundredths, as the server
 * counts them (toMinor and formatMinor of money.ts), whatever the currency
 * says of its own digits: 1000 JPY minor units are 10 yen there, so here too.
 */
export function fmtMinor(minor: number, currency: string, lang: string): string {
  const abs = Math.abs(Math.trunc(minor))
  const amount = `${minor < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
  return fmtMoney(amount, currency, lang)
}

/** The `amount` of a warning (order_paid), when the server sent a usable one. */
export function moneyOf(value: unknown): { minor: number; currency: string } | null {
  if (!value || typeof value !== "object") return null
  const v = value as { minor?: unknown; currency?: unknown }
  if (typeof v.minor !== "number" || !Number.isFinite(v.minor) || typeof v.currency !== "string" || !/^[A-Za-z]{3}$/.test(v.currency)) return null
  return { minor: v.minor, currency: v.currency }
}

/**
 * The value a problem or warning text puts in {{detail}}: its amount in the
 * admin's language when it has one (order_paid), else the detail the server
 * wrote for its logs, else the field.
 */
export function problemDetail(p: ProblemDto & { amount?: unknown }, lang: string): string {
  const money = moneyOf(p.amount)
  if (money) return fmtMinor(money.minor, money.currency, lang)
  return p.detail ?? p.field ?? ""
}

/* ------------------------------------------------------------------ */
/* The boxes refused by POST .../boxes                                 */
/* ------------------------------------------------------------------ */

/** The fields of a box as the boxes DTO names them; each has its words under plan.boxFields. */
export const BOX_FIELDS = ["weightKg", "lengthCm", "widthCm", "heightCm"] as const
export type BoxField = (typeof BOX_FIELDS)[number]

/** Other names a server may give the same field (the DPD request calls the sides sizeX, sizeY, sizeZ). */
const FIELD_ALIASES: Record<string, BoxField> = {
  weight: "weightKg",
  sizeX: "lengthCm",
  sizeXCm: "lengthCm",
  sizeY: "widthCm",
  sizeYCm: "widthCm",
  sizeZ: "heightCm",
  sizeZCm: "heightCm",
}

export type BoxFieldError = { index: number; field: string }

/**
 * The refused fields of a 400 of POST .../boxes, `fields` of its body: a
 * zero based box index and a field name. Entries of another shape are left
 * out; an empty list means the admin shows the server's message instead.
 */
export function boxFieldErrors(body: unknown): BoxFieldError[] {
  if (!body || typeof body !== "object") return []
  const fields = (body as { fields?: unknown }).fields
  if (!Array.isArray(fields)) return []
  const out: BoxFieldError[] = []
  for (const f of fields) {
    if (!f || typeof f !== "object") continue
    const { index, field } = f as { index?: unknown; field?: unknown }
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || typeof field !== "string" || !field) continue
    out.push({ index, field: FIELD_ALIASES[field] ?? field })
  }
  return out
}

export function isBoxField(field: string): field is BoxField {
  return (BOX_FIELDS as readonly string[]).includes(field)
}

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

/** The writers that write nothing yet in this version; the shipment writer already creates shipments. */
export const LATER_WRITERS: readonly WriterKey[] = ["pickup", "fulfillmentStatus"]

export function isLaterWriter(key: WriterKey): boolean {
  return LATER_WRITERS.includes(key)
}

/**
 * The writers that write now: armed (allowed and on) and used by this
 * version. An armed later writer writes nothing yet, so the header does not
 * count it as writing.
 */
export function writingWriters<W extends Pick<WriterDto, "key" | "armed">>(writers: Partial<Record<WriterKey, W>> | undefined): W[] {
  if (!writers) return []
  return Object.values(writers).filter((w): w is W => w !== undefined && w.armed && !isLaterWriter(w.key))
}

/**
 * Why a call to DPD cannot run: "off" when the options turn the shipment
 * writer off (arming it in Settings would not help), "not_armed" when a
 * person has not armed it, null when it writes. Without the writer (not
 * loaded yet) only `armed` counts.
 */
export function writerBlock(writer: Pick<WriterDto, "allowed"> | undefined, armed: boolean): "off" | "not_armed" | null {
  if (writer && !writer.allowed) return "off"
  return armed ? null : "not_armed"
}

/* ------------------------------------------------------------------ */
/* The label file                                                      */
/* ------------------------------------------------------------------ */

/** The file name of a label: the one of Content-Disposition when it is readable and plain, else the fallback. */
export function labelFileName(disposition: string | null, fallback: string): string {
  const m = disposition?.match(/filename="?([^";]+)"?/i)
  const name = m?.[1]?.trim() ?? ""
  return /^[\w.-]{1,120}\.pdf$/i.test(name) ? name : fallback
}

export type LabelFetcher = (url: string, init: RequestInit) => Promise<Response>

/**
 * The stored label PDF, fetched with the admin's auth (`init`, from the kit:
 * the session cookie or the JWT a bare URL in a new tab never carries). An
 * answer that is not ok throws DpdRequestError with the server's code, so a
 * removed or missing label reads as no_label.
 */
export async function fetchLabelFile(fetcher: LabelFetcher, url: string, init: RequestInit, fallbackName = "dpd-label.pdf"): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetcher(url, init)
  if (!res.ok) throw requestError(res.status, await res.text())
  const raw = await res.blob()
  const blob = raw.type === "application/pdf" ? raw : new Blob([raw], { type: "application/pdf" })
  return { blob, fileName: labelFileName(res.headers.get("content-disposition"), fallbackName) }
}

/* ------------------------------------------------------------------ */
/* DPD Pickup points                                                   */
/* ------------------------------------------------------------------ */

/**
 * What DPD said at the last attempt, for the block of the drawer under the
 * plan problems: the dpd_* problems of stage 2 and the Pickup problems DPD
 * gave with the plan's own codes (source "dpd"). A plan problem with the same
 * code but no source is the plan's, not DPD's, and stays out.
 */
export function answerProblems(problems: ProblemDto[]): ProblemDto[] {
  return problems.filter((p) => p.code.startsWith("dpd_") || p.source === "dpd")
}

export type PointTypeKey = (typeof POINT_TYPES)[number] | "other"

/** The word of a point type under pudo.types: a type of POINT_TYPES as it is (the lockers have their own), any other "other". */
export function pointTypeKey(type: string): PointTypeKey {
  const known = POINT_TYPES.find((t) => t === type)
  return known ?? "other"
}

export type PointHoursRange = { from: string; to: string }

/**
 * The week of a point, Monday (1) to Sunday (7), one row per day: its opening
 * ranges sorted by the hour they start, an empty list for a closed day.
 * Entries outside 1 to 7 and repeated ranges are left out. The ranges stay
 * pairs; the admin joins them with its own words (pudo.range).
 */
export function pointHoursRows(hours: PointHoursDto[]): Array<{ day: number; ranges: PointHoursRange[] }> {
  const rows: Array<{ day: number; ranges: PointHoursRange[] }> = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, ranges: [] }))
  for (const h of hours) {
    const row = rows[h.day - 1]
    if (!row || row.day !== h.day) continue
    if (row.ranges.some((r) => r.from === h.from && r.to === h.to)) continue
    row.ranges.push({ from: h.from, to: h.to })
  }
  for (const row of rows) row.ranges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  return rows
}

/**
 * The limits of a point as the values of its pudo.limits text: fits gives
 * kg and the three sides a, b, c; sum kg, side and sum; girth kg, length and
 * girth.
 */
export function pointLimitParts(l: PointLimitsDto): { key: "fits" | "sum" | "girth"; values: Record<string, number> } {
  const b = l.box
  if (b.kind === "fits") return { key: "fits", values: { kg: l.maxKg, a: b.sidesCm[0], b: b.sidesCm[1], c: b.sidesCm[2] } }
  if (b.kind === "sum") return { key: "sum", values: { kg: l.maxKg, side: b.maxSideCm, sum: b.maxSumCm } }
  return { key: "girth", values: { kg: l.maxKg, length: b.maxLengthCm, girth: b.maxGirthCm } }
}

/** The address of a point on one line, for the confirmation of a change: "Skoroszewska 11, 02-495 Warszawa". */
export function pointAddressLine(p: Pick<PointDto, "address">): string {
  const a = p.address
  return [a.line1, a.line2, `${a.zip} ${a.city}`.trim()].filter((s): s is string => Boolean(s && s.trim())).join(", ")
}

/**
 * Whether the drawer offers to change the point: the row may be planned, it
 * goes out (not a return) and its option is a Pickup one. Also for a plan
 * without a point or with a wrong id (those are the rows that need it) and
 * for a Pickup plan that stopped before the point. No writer is needed: the
 * change writes only the plugin's own row.
 */
export function canChangePoint(shipment: Pick<ShipmentDto, "kind" | "actions">, plan: Pick<PlanDto, "kind">): boolean {
  return shipment.actions.plan && shipment.kind === "outbound" && plan.kind === "pickup"
}

/** The states whose error a person should read. */
const ERROR_STATES: readonly ShipmentDto["state"][] = ["failed", "unknown", "ambiguous", "abandoned_unknown"]

/**
 * The codes of a pending row the pass leaves to a person: a create the
 * pacing held back after a click, a Pickup point nobody could check (DS13).
 * Without their words the row reads as a plain Pending.
 */
export const PENDING_ERROR_CODES: readonly string[] = ["rate_limited_manual", "point_unchecked"]

/**
 * Whether a row shows its error, and in which tone: refused, unclear and
 * mismatched rows red; a row with waybills whose label did not come, and a
 * pending row held back for a person, orange. Null: nothing to read.
 */
export function errorTone(s: Pick<ShipmentDto, "state" | "errorCode">): "red" | "orange" | null {
  if (ERROR_STATES.includes(s.state)) return "red"
  if (s.state === "created" && s.errorCode) return "orange"
  if (s.state === "pending" && s.errorCode && PENDING_ERROR_CODES.includes(s.errorCode)) return "orange"
  return null
}

/**
 * The point the customer chose, when the shipment now goes to another one (a
 * person changed it in the admin): the order keeps the customer's choice.
 * Null for a courier row, a return, or the same point.
 */
export function customerChoseOther(chosenPudoId: string | null | undefined, shipment: Pick<ShipmentDto, "kind" | "optionKind" | "pudoId">): string | null {
  if (shipment.kind !== "outbound" || shipment.optionKind !== "pickup" || !chosenPudoId) return null
  return chosenPudoId === shipment.pudoId ? null : chosenPudoId
}

/**
 * The query of the point search of the admin (GET /admin/dpd/points), by
 * postal code and city only: null until the postal code has five digits (a
 * hyphen is allowed and dropped). The city is trimmed and sent only when
 * set; cod only when true.
 */
export function pointsQuery(q: { zip?: string; city?: string; cod?: boolean } | null): Record<string, string> | null {
  if (!q) return null
  const zip = (q.zip ?? "").trim().replace(/-/g, "")
  if (!/^\d{5}$/.test(zip)) return null
  const out: Record<string, string> = { zip }
  const city = (q.city ?? "").trim().replace(/\s+/g, " ")
  if (city) out.city = city
  if (q.cod) out.cod = "true"
  return out
}

/** Whether two searches ask the same (the same query key): a search asked again is read again only by hand, the key does not change. */
export function sameSearch(a: { zip?: string; city?: string; cod?: boolean } | null, b: { zip?: string; city?: string; cod?: boolean } | null): boolean {
  const x = pointsQuery(a)
  const y = pointsQuery(b)
  if (x === null || y === null) return x === y
  return x.zip === y.zip && x.city === y.city && x.cod === y.cod
}
