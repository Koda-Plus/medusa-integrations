import { DISPATCH_CLAIMED_STATES, POINT_TYPES } from "../../modules/dpd/lib/constants"
import type {
  CourierOrderRequest,
  CourierRangeDto,
  DispatchDto,
  DispatchFilter,
  DispatchProtocolDto,
  DispatchState,
  PlanDto,
  PointDto,
  PointHoursDto,
  PointLimitsDto,
  ProblemDto,
  ShipmentDto,
  WriterDto,
  WriterKey,
} from "../../modules/dpd/lib/contract"

/**
 * The plain logic of the admin: no React, no kit, no DOM, so `node --test`
 * loads it (the .tsx files around it it cannot). Errors of the admin API,
 * money, the refused fields of the boxes, the writers, the label file, the
 * DPD Pickup points and the handovers to the courier.
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

/** The writers that write nothing yet in this version; the shipment writer creates shipments, the pickup writer orders couriers. */
export const LATER_WRITERS: readonly WriterKey[] = ["fulfillmentStatus"]

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
 * Why a call to DPD cannot run: "off" when the options turn the writer off
 * (arming it in Settings would not help), "not_armed" when a person has not
 * armed it, null when it writes. Without the writer (not loaded yet) only
 * `armed` counts.
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

/* ------------------------------------------------------------------ */
/* Handovers to the courier                                            */
/* ------------------------------------------------------------------ */

/** The filters of the handover list, as the page URL (?filter) and the route take them. */
export const DISPATCH_FILTERS = ["open", "attention", "all"] as const

/** ?filter of the page for the handover section; anything else: "open". */
export function dispatchFilterOf(v: string | null): DispatchFilter {
  return DISPATCH_FILTERS.find((f) => f === v) ?? "open"
}

const CLAIMED_DISPATCH: readonly DispatchState[] = DISPATCH_CLAIMED_STATES

/** A request is working on the handover now (printing, ordering, changing the order): the view polls it. */
export function isClaimedDispatch(state: DispatchState): boolean {
  return CLAIMED_DISPATCH.includes(state)
}

/**
 * The poll of a handover saw the work end: it was claimed and is not any
 * more. Only the view polls a claimed handover, so then the list, the
 * shipments and the tile read it again. null: nothing read yet.
 */
export function dispatchLeftClaim(before: DispatchState | null, now: DispatchState | null): boolean {
  return before !== null && now !== null && isClaimedDispatch(before) && !isClaimedDispatch(now)
}

/** The tones of a handover badge (the Tone values of the blocks it uses). */
export type DispatchTone = "red" | "orange" | "blue" | "green" | "grey"

/* Orange waits for a person, blue works, green is done, red needs a person to check, grey left the work. */
const DISPATCH_TONE: Record<DispatchState, DispatchTone> = {
  pending: "orange",
  printing: "blue",
  printed: "orange",
  ordering: "blue",
  ordered: "green",
  updating: "blue",
  unknown: "red",
  canceled: "grey",
}

/** The tone of the state badge of a handover: red whenever it needs a person (DS18). */
export function dispatchTone(d: Pick<DispatchDto, "state" | "attention">): DispatchTone {
  return d.attention ? "red" : DISPATCH_TONE[d.state]
}

/** One pickup window a person can choose: `value` is the key of the select, `raw` the range as DPD wrote it. */
export type WindowChoice = { value: string; from: string; to: string; raw: string }

/**
 * The ranges as choices for one date: unique by from and to, sorted. On
 * today a range whose `to` is not after nowTime is left out (date_past, O14).
 * today and nowTime always come from the same AvailabilityResponse (the
 * server, Europe/Warsaw), never from the browser clock (E7).
 */
export function courierWindowChoices(ranges: readonly CourierRangeDto[], date: string, today: string, nowTime: string): WindowChoice[] {
  const out: WindowChoice[] = []
  for (const r of ranges) {
    if (date === today && r.to <= nowTime) continue
    const value = `${r.from}-${r.to}`
    if (out.some((c) => c.value === value)) continue
    out.push({ value, from: r.from, to: r.to, raw: r.raw })
  }
  return out.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
}

/** The actions of a handover that need a writer. */
export type DispatchWriterAction = "print" | "reprint" | "cancel" | "order" | "reschedule" | "cancelCourier" | "resolve" | "withdraw"

/**
 * The one writer an action of a handover needs, the same as the server's
 * (10.1): the protocol and the handover itself the shipment writer, the
 * courier order the pickup writer. Taking a shipment out changes the courier
 * order only when one is ordered: pickup for "ordered", else shipment (6.9
 * point 3, E21). Never both.
 */
export function dispatchActionWriter(action: DispatchWriterAction, state: DispatchState): WriterKey {
  if (action === "withdraw") return state === "ordered" ? "pickup" : "shipment"
  return action === "print" || action === "reprint" || action === "cancel" ? "shipment" : "pickup"
}

/**
 * The tone of the last error of a handover (DispatchErrorText, E24): null
 * without an error, and while a request works on it (the claim presets the
 * code of a lease expiry); red when it needs a person; else orange.
 */
export function dispatchErrorTone(d: Pick<DispatchDto, "state" | "error" | "errorCode" | "attention">): "red" | "orange" | null {
  if (!d.error && !d.errorCode) return null
  if (isClaimedDispatch(d.state)) return null
  return d.attention || d.state === "unknown" ? "red" : "orange"
}

/** The body of an order or a change of the pickup: the date and the chosen window. */
export function courierRequestOf(date: string, choice: WindowChoice): CourierOrderRequest {
  return { pickupDate: date, pickupTimeFrom: choice.from, pickupTimeTo: choice.to }
}

/** The date the form starts on: tomorrow (days[1]) when there is one, else today; null for no days. */
export function defaultCourierDate(days: readonly string[]): string | null {
  return days[1] ?? days[0] ?? null
}

/**
 * A pickup date ("2026-11-04") in the admin's language, as a day in Warsaw.
 * Noon UTC is the same day there in every season, so the browser clock and
 * its zone never shift the day.
 */
export function fmtPickupDate(date: string, lang: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const d = new Date(`${date}T12:00:00Z`)
  if (!Number.isFinite(d.getTime())) return date
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "Europe/Warsaw" }).format(d)
  } catch {
    return date
  }
}

/** The most shipments of one handover (DISPATCH_MAX_SHIPMENTS, DS17), repeated here for the selection of the list. */
export const SELECTION_MAX = 100

/**
 * The selection after ticking (on) or clearing (off) some ids, in the order
 * given. Ticking stops at SELECTION_MAX: the ids past it stay out.
 */
export function selectionToggle(selected: ReadonlySet<string>, ids: readonly string[], on: boolean): Set<string> {
  const next = new Set(selected)
  for (const id of ids) {
    if (!on) next.delete(id)
    else if (!next.has(id) && next.size < SELECTION_MAX) next.add(id)
  }
  return next
}

/**
 * The selection without the shipments that stopped being candidates: a row of the page
 * without actions.dispatch (do not send, handed over in another tab) has no box to untick,
 * so it leaves the selection. Ids of other pages stay; the same set when nothing goes.
 */
export function selectionPrune(selected: ReadonlySet<string>, rows: ReadonlyArray<{ id: string; actions: { dispatch: boolean } }>): ReadonlySet<string> {
  const gone = rows.filter((r) => !r.actions.dispatch && selected.has(r.id)).map((r) => r.id)
  return gone.length === 0 ? selected : selectionToggle(selected, gone, false)
}

/**
 * The page of a list once its count is known: the last page when the list
 * shrank below the current one (the last row of the last page was resolved,
 * withdrawn or sent), so the table never shows "empty" under a nonzero count.
 */
export function pageInRange(page: number, count: number, size: number): number {
  const last = Math.max(0, Math.ceil(count / size) - 1)
  return Math.min(Math.max(0, page), last)
}

/** The header checkbox of a page: none, some or all of its selectable rows are selected. */
export function selectionPageState(selected: ReadonlySet<string>, pageIds: readonly string[]): "none" | "some" | "all" {
  const n = pageIds.filter((id) => selected.has(id)).length
  if (n === 0) return "none"
  return n === pageIds.length ? "all" : "some"
}

/**
 * The main button of a handover row: resolve, print, order, protocol, in
 * this order of its actions. Resolve is the main button only when the row
 * needs a person; an ordered row without a checkSum (O16) keeps it among
 * the icons, so a calm row does not offer "Resolve" first. null: none.
 */
export function dispatchMainAction(d: DispatchDto): "resolve" | "print" | "order" | "protocol" | null {
  if (d.actions.resolve && d.attention) return "resolve"
  if (d.actions.print) return "print"
  if (d.actions.order) return "order"
  if (d.actions.protocol) return "protocol"
  return null
}

/** Why the courier cannot be ordered with the handover: the pickup writer, then the problems of the plan. */
export type CourierBlock = { kind: "writer"; writer: WriterDto } | { kind: "problems"; problems: ProblemDto[] } | null

/** The courier checkbox and the order button: the pickup writer armed first, then orderProblems empty. Without the writers (not loaded) only the problems count. */
export function courierBlock(writers: Record<WriterKey, WriterDto> | undefined, orderProblems: readonly ProblemDto[]): CourierBlock {
  const writer = writers?.pickup
  if (writer && !writer.armed) return { kind: "writer", writer }
  return orderProblems.length > 0 ? { kind: "problems", problems: [...orderProblems] } : null
}

/** The newest stored protocol of a handover, or null. */
export function latestProtocol(d: Pick<DispatchDto, "protocols">): DispatchProtocolDto | null {
  let newest: DispatchProtocolDto | null = null
  for (const p of d.protocols) {
    if (!newest || (p.createdAt ?? "") > (newest.createdAt ?? "")) newest = p
  }
  return newest
}

/**
 * The stage of the handover loader (dispatch, protocol, order) "Try again"
 * starts at, read from the handover as it is now, never from the code the
 * run stopped with: a refused protocol and a refused order share codes
 * (pickup_fid, parcel_limit), and a print or an order made meanwhile (the
 * view's own button, an answer lost on the way back) is never sent twice.
 * 0 before the handover exists; 1 (the protocol) only while it is pending;
 * 2 (the courier) only while it is printed and the run orders one. null:
 * nothing to repeat (printed without a courier, ordered, an unknown order to
 * resolve first, canceled, a step still running, or the state not read yet).
 */
export function handoverStepOf(state: DispatchState | null, created: boolean, withCourier: boolean): 0 | 1 | 2 | null {
  if (!created) return 0
  if (state === "pending") return 1
  if (state === "printed" && withCourier) return 2
  return null
}

/**
 * Whether a stopped run of the drawer is history, so its loader goes: a read
 * after the stop shows the handover moved on. With the state of the answer,
 * any other state; after a failed request (no state) a state past the stage
 * the run stopped at that "Try again" cannot continue from, e.g. a print the
 * server finished behind a lost answer, or an order made from the view.
 */
export function stoppedRunMovedOn(
  stopped: { state: DispatchState | null; stage: "protocol" | "order" } | null,
  fresh: DispatchState | null,
  retryFrom: number | null,
): boolean {
  if (!stopped || !fresh) return false
  if (stopped.state) return fresh !== stopped.state
  if (retryFrom !== null) return false
  const at: readonly DispatchState[] = stopped.stage === "protocol" ? ["pending", "printing"] : ["printed", "ordering"]
  return !at.includes(fresh)
}

/**
 * The error code that explains a failed reschedule, courier cancel or withdraw, or null.
 * An ordered handover with an attention code keeps that code on every result of a change
 * (P10): the same code after the call tells nothing about this attempt, like a reprint
 * (printToastKind), so the person gets the generic text instead of an old reason.
 */
export function changeReasonCode(before: Pick<DispatchDto, "attention" | "errorCode">, after: Pick<DispatchDto, "errorCode">): string | null {
  if (!after.errorCode) return null
  return before.attention && after.errorCode === before.errorCode ? null : after.errorCode
}

/**
 * Whether the courier form may still send its order or change: the handover
 * allows the mode now. The newer of the handover the host holds and the last
 * answer of the form counts (updatedAt; a tie is the answer), so an order
 * that went unknown is never offered again before the host has read it. null
 * answer: the form has sent nothing yet.
 */
export function courierFormAllowed(mode: "order" | "reschedule", live: Pick<DispatchDto, "actions" | "updatedAt">, answer: Pick<DispatchDto, "actions" | "updatedAt"> | null): boolean {
  const now = answer && !(Date.parse(live.updatedAt ?? "") > Date.parse(answer.updatedAt ?? "")) ? answer : live
  return mode === "order" ? now.actions.order : now.actions.reschedule
}

/**
 * The toast of a print: a new protocol (more stored than before the call)
 * is the only sign of success, since an ordered handover with an attention
 * code keeps that code on every result of a reprint (P10). "failed" is such
 * a handover without a new protocol: its code tells nothing about the print.
 */
export function printToastKind(d: Pick<DispatchDto, "state" | "errorCode" | "attention" | "protocols">, protocolsBefore: number): "printed" | "unclear" | "refused" | "failed" {
  if ((d.state === "printed" || d.state === "ordered") && d.protocols.length > protocolsBefore) return "printed"
  if (d.attention) return "failed"
  return d.errorCode === "protocol_unclear" ? "unclear" : "refused"
}
