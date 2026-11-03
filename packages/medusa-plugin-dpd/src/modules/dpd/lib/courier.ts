import type { CourierRangeDto, ProblemDto } from "./contract"
import type { ResolvedDpdOptions } from "./options"
import type { DispatchAnswerCode, DispatchRefused } from "./dpd-answers"
import type { PackagesPickupCallCreateRequest, PackagesPickupCallUpdateRequest } from "./dpdservices"
import {
  BOX_SIDE_MAX_CM, COURIER_CHECKSUM_MAX, COURIER_CHECKSUM_MIN, COURIER_DAYS_AHEAD, COURIER_ORDER_MAX_KG,
  COURIER_RANGE_PATTERN, COURIER_TIME_PATTERN, COURIER_TIME_ZONE,
} from "./constants"

/**
 * THE COURIER ORDER, pure: the calendar of Europe/Warsaw, the availability
 * ranges DPD gives, the window a person picks and the rules DPD checks on a
 * packagesPickupCall, shared by the flow and the simulator (courier-sim.ts).
 *
 * Every date of a courier order is a date in Europe/Warsaw, computed with
 * Intl.DateTimeFormat and an explicit time zone, never with the kit's tzOf
 * (UTC by default): a courier comes on a Polish calendar day.
 */

const DATE_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: COURIER_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
const TIME_PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: COURIER_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })

function partsOf(format: Intl.DateTimeFormat, now: Date): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of format.formatToParts(now)) out[p.type] = p.value
  return out
}

/** yyyy-MM-dd of `now` in Europe/Warsaw (Intl.DateTimeFormat with timeZone, never tzOf). */
export function warsawDate(now: Date): string {
  const p = partsOf(DATE_PARTS, now)
  return `${p.year}-${p.month}-${p.day}`
}

/** HH:mm of `now` in Europe/Warsaw. */
export function warsawTime(now: Date): string {
  const p = partsOf(TIME_PARTS, now)
  /* Some engines print midnight as "24" even with h23. */
  return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** A calendar date plus n days (no time zone: yyyy-MM-dd arithmetic). */
export function addDays(date: string, n: number): string {
  const m = ISO_DATE.exec(date)
  if (!m) throw new Error(`addDays: not a yyyy-MM-dd date: ${date}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10)
}

/** today .. today + ahead, inclusive, Europe/Warsaw. */
export function courierDays(now: Date, ahead: number = COURIER_DAYS_AHEAD): string[] {
  const today = warsawDate(now)
  return Array.from({ length: ahead + 1 }, (_, i) => addDays(today, i))
}

/** yyyy-MM-dd of a real calendar day ("2026-02-30" is not). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string") return false
  const m = ISO_DATE.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** HH:mm, two digits each (COURIER_TIME_PATTERN). */
export function isCourierTime(v: unknown): v is string {
  return typeof v === "string" && COURIER_TIME_PATTERN.test(v)
}

/** "08:00-16:00" -> { from: "08:00", to: "16:00" }; null for anything else or from >= to. */
export function parseCourierRange(range: unknown): { from: string; to: string } | null {
  if (typeof range !== "string") return null
  const m = COURIER_RANGE_PATTERN.exec(range.trim())
  if (!m) return null
  const from = `${m[1]}:${m[2]}`
  const to = `${m[3]}:${m[4]}`
  return from < to ? { from, to } : null
}

/** RangesResponse[] -> parsed ranges; unreadable entries dropped. raw is the range as DPD wrote it. */
export function courierRangesOf(value: unknown): CourierRangeDto[] {
  if (!Array.isArray(value)) return []
  const out: CourierRangeDto[] = []
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue
    const { range, offset } = entry as { range?: unknown; offset?: unknown }
    const parsed = parseCourierRange(range)
    if (!parsed || typeof range !== "string") continue
    out.push({ ...parsed, offset: typeof offset === "number" && Number.isInteger(offset) ? offset : null, raw: range })
  }
  return out
}

export type CourierRange = CourierRangeDto

export type CourierWindow = { pickupDate: string; pickupTimeFrom: string; pickupTimeTo: string }

export const COURIER_WINDOW_CODES = ["date_invalid", "date_past", "date_too_far", "time_invalid", "time_order", "window_outside", "no_ranges"] as const
export type CourierWindowCode = (typeof COURIER_WINDOW_CODES)[number]

type WindowProblem = ProblemDto & { code: CourierWindowCode }

/**
 * The window a person chose against DS11: date today .. today + ahead,
 * HH:mm with from < to, wholly inside one range. ranges null = not checked
 * (the simulator); [] = no_ranges. field: pickupDate | pickupTimeFrom | pickupTimeTo.
 */
export function courierWindowProblems(w: CourierWindow, ranges: readonly CourierRangeDto[] | null, today: string, ahead: number = COURIER_DAYS_AHEAD): WindowProblem[] {
  const out: WindowProblem[] = []
  if (!isIsoDate(w.pickupDate)) out.push({ code: "date_invalid", field: "pickupDate" })
  else if (w.pickupDate < today) out.push({ code: "date_past", field: "pickupDate" })
  else if (w.pickupDate > addDays(today, ahead)) out.push({ code: "date_too_far", field: "pickupDate", detail: String(ahead) })
  const fromOk = isCourierTime(w.pickupTimeFrom)
  const toOk = isCourierTime(w.pickupTimeTo)
  if (!fromOk) out.push({ code: "time_invalid", field: "pickupTimeFrom" })
  if (!toOk) out.push({ code: "time_invalid", field: "pickupTimeTo" })
  if (!fromOk || !toOk) return out
  if (w.pickupTimeFrom >= w.pickupTimeTo) {
    out.push({ code: "time_order", field: "pickupTimeTo" })
    return out
  }
  if (ranges === null) return out
  if (ranges.length === 0) out.push({ code: "no_ranges", field: "pickupTimeFrom" })
  else if (!ranges.some((r) => r.from <= w.pickupTimeFrom && w.pickupTimeTo <= r.to)) {
    out.push({ code: "window_outside", field: "pickupTimeFrom", detail: ranges.map((r) => r.raw).join(", ") })
  }
  return out
}

/* The words DPD's Bean Validation used on the demo host (12d, 12g, 12w), so a local refusal reads like DPD's. */
const PAST_DATE_MESSAGE = "must be a date in the present or in the future"
const CHECKSUM_MESSAGE = `size must be between ${COURIER_CHECKSUM_MIN} and ${COURIER_CHECKSUM_MAX}`
const PARAMS_FIELD = "packagesForCollection.packagesParams.parcel"
const SIDES = ["maxHeight", "maxWidth", "maxDepth"] as const

type CourierBody = PackagesPickupCallCreateRequest | PackagesPickupCallUpdateRequest | { orderNumber: string; checkSum: string }

function refusal(code: DispatchAnswerCode, message: string, problems: ProblemDto[]): DispatchRefused {
  return { kind: "refused", code, message, problems, traceId: null, httpStatus: 400 }
}

/** The checks DPD makes with Bean Validation (HTTP 400, errors[]), as dpd_validation problems. */
function beanProblems(body: CourierBody, ctx: { today: string; op: "create" | "update" | "delete" }): ProblemDto[] {
  const out: ProblemDto[] = []
  if ((ctx.op === "update" || ctx.op === "delete") && "checkSum" in body) {
    const n = typeof body.checkSum === "string" ? body.checkSum.length : 0
    if (n < COURIER_CHECKSUM_MIN || n > COURIER_CHECKSUM_MAX) {
      out.push({ code: "dpd_validation", field: ctx.op === "delete" ? "packagesPickupCallDelete.checkSum" : "checkSum", detail: CHECKSUM_MESSAGE })
    }
  }
  if (ctx.op === "delete" || !("packagesForCollection" in body)) return out
  if (isIsoDate(body.pickupDate) && body.pickupDate < ctx.today) out.push({ code: "dpd_validation", field: "pickupDate", detail: PAST_DATE_MESSAGE })
  const parcel = body.packagesForCollection.packagesParams.parcel
  if (parcel.maxWeight > COURIER_ORDER_MAX_KG) {
    out.push({ code: "dpd_validation", field: `${PARAMS_FIELD}.maxWeight`, detail: `must be less than or equal to ${COURIER_ORDER_MAX_KG}` })
  }
  for (const side of SIDES) {
    if (parcel[side] > BOX_SIDE_MAX_CM) out.push({ code: "dpd_validation", field: `${PARAMS_FIELD}.${side}`, detail: `must be less than or equal to ${BOX_SIDE_MAX_CM}` })
  }
  return out
}

/** The DPD rules seen on the demo host (H11) and in the OpenAPI, shared by the flow and the simulator: past date, maxWeight > 50, sides > 300, checkSum length, payer FID. Null = valid. */
export function validateCourierCall(
  body: CourierBody,
  ctx: { today: string; payerFid: number | null; op: "create" | "update" | "delete" },
): DispatchRefused | null {
  const bean = beanProblems(body, ctx)
  if (bean.length > 0) {
    /* The same order as the classifier (spec 8.6): checksum before pickup_time before validation. */
    const code: DispatchAnswerCode = bean.some((p) => p.field?.endsWith("checkSum"))
      ? "checksum"
      : bean.some((p) => p.field === "pickupDate")
        ? "pickup_time"
        : "validation"
    const details = bean.map((p) => `${p.field}: ${p.detail}`).join("; ")
    return refusal(code, `The courier order breaks a DPD rule (checked before sending): ${details}.`, bean)
  }
  if (ctx.op === "create" && ctx.payerFid !== null && "packagesForCollection" in body && "number" in body.packagesForCollection.payer) {
    if (body.packagesForCollection.payer.number !== ctx.payerFid) {
      return refusal("payer_fid", "DPD takes courier orders only for the payer FID of this account (DISALLOWED_FID).", [
        { code: "dpd_payer_fid" },
        { code: "dpd_courier", field: "PickupPayer/PickupNumber", detail: "INCORRECT_VALUE" },
      ])
    }
  }
  return null
}

/** How courier orders run in this mode: demo (simulated, demo), simulated (sandbox, DS4), dpd (live). */
export function courierOrdersOf(o: Pick<ResolvedDpdOptions, "demo" | "mode">): "demo" | "simulated" | "dpd" {
  return o.demo ? "demo" : o.mode === "sandbox" ? "simulated" : "dpd"
}
