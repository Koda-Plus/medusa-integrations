import { createHash } from "node:crypto"
import { EVENT_TIME_ZONE, INFOSERVICES_NAMESPACE, OPTION_SPECS, SIM_COUNTRY, SIM_DEPOT, SIM_IN_POINT } from "./constants"
import { waybillsOf, type ShipmentRow } from "./dto"
import { parseEventsResponse, warsawToUtc, type WaybillEventsOutcome } from "./infoservices"
import { readTracking } from "./tracking"

/**
 * THE STATUS SIMULATOR OF DEMO AND THE SANDBOX (DS8, 6.7, 9.1). DPD has no
 * test host for InfoServices, so these modes get their events from here: a
 * pure function of the row, the waybill and `now`, counted from the handover,
 * without memory (a restart loses nothing). It builds the XML of a
 * getEventsForWaybillV1 answer in the shape of the PDF and sends it through
 * the real parser and the real code map.
 *
 * Codes only with a source (the PDF or the libraries it cites) [NZ]; the
 * steps without a known code (the parcel taken in by a Pickup point) use
 * SIM_ codes only the built in map knows. No receiver data: the only
 * eventDataList value is the new waybill of a return.
 */

export type SimVariant = "regular" | "failed_attempt" | "return" | "pickup"
/** One step of a timeline (6.7): minutes after handed_over_at; `leg: "return"` = an event of the new return waybill. */
export type SimStep = { afterMin: number; code: string; description: string; leg?: "return" }

const PICKED_UP: SimStep = { afterMin: 30, code: "040101", description: "Przesyłka odebrana przez Kuriera" }
const AT_DEPOT: SimStep = { afterMin: 90, code: "050101", description: "Przyjęcie przesyłki w oddziale DPD" }
const OUT_FOR_DELIVERY: SimStep = { afterMin: 240, code: "170101", description: "Wydanie przesyłki do doręczenia" }
const DELIVERED = "Przesyłka doręczona"

export const SIM_TIMELINES: Readonly<Record<SimVariant, readonly SimStep[]>> = {
  regular: [PICKED_UP, AT_DEPOT, OUT_FOR_DELIVERY, { afterMin: 360, code: "190101", description: DELIVERED }],
  failed_attempt: [
    PICKED_UP,
    AT_DEPOT,
    OUT_FOR_DELIVERY,
    { afterMin: 360, code: "200300", description: "Przesyłka niedoręczona, odbiorca nieobecny" },
    { afterMin: 1440, code: "170101", description: OUT_FOR_DELIVERY.description },
    { afterMin: 1560, code: "190101", description: DELIVERED },
  ],
  return: [
    PICKED_UP,
    AT_DEPOT,
    OUT_FOR_DELIVERY,
    { afterMin: 360, code: "230403", description: "Zwrot przesyłki" },
    { afterMin: 720, code: "050101", description: AT_DEPOT.description, leg: "return" },
    { afterMin: 1440, code: "190101", description: DELIVERED, leg: "return" },
  ],
  pickup: [
    PICKED_UP,
    AT_DEPOT,
    { afterMin: 240, code: SIM_IN_POINT, description: "Przyjęcie przesyłki do punktu Pickup" },
    { afterMin: 480, code: "190101", description: DELIVERED },
  ],
}

/** Before the handover: one 030103 at created_at. */
export const SIM_BEFORE_HANDOVER: SimStep = { afterMin: 0, code: "030103", description: "Zarejestrowano dane przesyłki, przesyłka jeszcze nie nadana" }


function hexOf(waybill: string): string {
  return createHash("sha256").update(waybill).digest("hex")
}

/** pickup option: "pickup"; else by the first 8 hex digits of sha256(waybill) as a number % 20: 0 and 1 failed_attempt, 2 return, else regular. */
export function simVariant(waybill: string, pickup: boolean): SimVariant {
  if (pickup) return "pickup"
  const n = parseInt(hexOf(waybill).slice(0, 8), 16) % 20
  if (n === 0 || n === 1) return "failed_attempt"
  return n === 2 ? "return" : "regular"
}

/** "9" + 12 digits from sha256(waybill) + "R" (matches WAYBILL_PATTERN, never a real waybill). */
export function simReturnWaybill(waybill: string): string {
  /* An own copy of digits() of demo.ts (not exported there): digit i is hex digit i mod 10. */
  const hex = hexOf(waybill)
  let digits = ""
  for (let i = 0; i < 12; i++) digits += String(parseInt(hex.charAt(i), 16) % 10)
  return `9${digits}R`
}

/** What the simulator reads of a row. */
export type SimRow = Pick<ShipmentRow, "option_id" | "handed_over_at" | "created_at" | "waybills"> & { tracking?: unknown }

/** depotName of every simulated event, like the PDF example (s.21). */
const SIM_DEPOT_NAME = "Warszawa"
const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000

const WALL = new Intl.DateTimeFormat("en-US", {
  timeZone: EVENT_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

/** YYYY-MM-DDTHH:mm:ss of the instant in Europe/Warsaw, without a zone, as DPD writes eventTime. */
function warsawWall(ms: number): string {
  const p: Record<string, string> = {}
  for (const part of WALL.formatToParts(new Date(ms))) p[part.type] = part.value
  const hour = String(Number(p.hour) % 24).padStart(2, "0")
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}`
}

/**
 * The instant a step is written at: `ms`, or for an instant in the hour
 * repeated at the end of summer time (its wall time reads back an hour
 * early, warsawToUtc takes the earlier instant) the end of that hour, when
 * the wall time is unique again (Warsaw offsets are whole hours). Never
 * earlier and monotone, so the parsed events keep the order of the steps; a
 * step in that hour shows up when the hour ends, like a late DPD scan.
 */
function readableAt(ms: number): number {
  const back = Date.parse(warsawToUtc(warsawWall(ms)) ?? "")
  if (!Number.isFinite(back) || back >= Math.floor(ms / 1000) * 1000) return ms
  return Math.floor(ms / HOUR_MS) * HOUR_MS + HOUR_MS
}

function whenMs(v: Date | string | null | undefined): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null
  if (typeof v === "string" && v !== "") {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;")
}

function isPickup(row: SimRow): boolean {
  return OPTION_SPECS.find((s) => s.id === row.option_id)?.kind === "pickup"
}

type DueStep = { at: number; step: SimStep }

/** 9.1 "which events": the return leg for a return waybill made by the simulator, else 030103 and the steps of the variant due by now. */
function dueSteps(row: SimRow, waybill: string, now: Date): DueStep[] {
  const nowMs = now.getTime()
  const handed = whenMs(row.handed_over_at)
  const pickup = isPickup(row)
  const origin = readTracking(row.tracking, waybillsOf(row.waybills)).find((e) => e.waybill === waybill && e.from !== null && waybill === simReturnWaybill(e.from))?.from ?? null
  const out: DueStep[] = []
  if (origin !== null) {
    if (handed === null || simVariant(origin, pickup) !== "return") return out
    for (const step of SIM_TIMELINES.return) {
      const at = readableAt(handed + step.afterMin * MINUTE_MS)
      if (step.leg === "return" && at <= nowMs) out.push({ at, step })
    }
    return out
  }
  const created = whenMs(row.created_at)
  const createdAt = created === null ? null : readableAt(created)
  if (createdAt !== null && createdAt <= nowMs) out.push({ at: createdAt, step: SIM_BEFORE_HANDOVER })
  if (handed !== null) {
    for (const step of SIM_TIMELINES[simVariant(waybill, pickup)]) {
      const at = readableAt(handed + step.afterMin * MINUTE_MS)
      if (step.leg === undefined && at <= nowMs) out.push({ at, step })
    }
  }
  return out
}

/** The getEventsForWaybillV1 response XML of the events due by `now`, in the PDF shape (depot SIM_DEPOT, country SIM_COUNTRY, objectId 0, eventDataList only at 230403 with the new waybill under 01). */
export function simulatedEventsXml(row: SimRow, waybill: string, now: Date): string {
  const hex = hexOf(waybill)
  const millis = String(parseInt(hex.slice(8, 16), 16) % 1000).padStart(3, "0")
  /* Newest first, on purpose: the pass sorts by eventTime itself (H6). A stable sort keeps steps of one readableAt in step order, the order the fold reads a tie in. */
  const steps = dueSteps(row, waybill, now).sort((a, b) => b.at - a.at)
  const events = steps.map(({ at, step }) => {
    const time = warsawWall(at) + (step.code === "190101" ? `.${millis}` : "")
    /* The only eventDataList: the new waybill of a return, a CDATA written as entities like the PDF (s.16). */
    const data = step.code === "230403" ? [`          <eventDataList>`, `            <code>01</code>`, `            <value>${esc(`<![CDATA[${simReturnWaybill(waybill)}]]>`)}</value>`, `          </eventDataList>`] : []
    return [
      `        <eventsList>`,
      `          <businessCode>${esc(step.code)}</businessCode>`,
      `          <country>${SIM_COUNTRY}</country>`,
      `          <depot>${SIM_DEPOT}</depot>`,
      `          <depotName>${SIM_DEPOT_NAME}</depotName>`,
      `          <description>${esc(step.description)}</description>`,
      ...data,
      `          <eventTime>${time}</eventTime>`,
      `          <objectId>0</objectId>`,
      `          <packageReference/>`,
      `          <parcelReference/>`,
      `          <waybill>${esc(waybill)}</waybill>`,
      `        </eventsList>`,
    ].join("\n")
  })
  return [
    `<S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">`,
    `  <S:Body>`,
    `    <ns2:getEventsForWaybillV1Response xmlns:ns2="${INFOSERVICES_NAMESPACE}">`,
    `      <return>`,
    `        <confirmId>0</confirmId>`,
    ...events,
    `      </return>`,
    `    </ns2:getEventsForWaybillV1Response>`,
    `  </S:Body>`,
    `</S:Envelope>`,
  ].join("\n")
}

/** simulatedEventsXml through parseEventsResponse: { kind: "ok", httpStatus: 200, ms: 0 }. A waybill with `from` in the row tracking follows the return leg of its origin. */
export function simulatedAnswer(row: SimRow, waybill: string, now: Date): WaybillEventsOutcome {
  const value = parseEventsResponse(simulatedEventsXml(row, waybill, now))
  if (value) return { kind: "ok", value, httpStatus: 200, ms: 0 }
  return { kind: "unclear", code: "bad_answer", message: "The status simulator built an unreadable answer.", httpStatus: 0, ms: 0 }
}
