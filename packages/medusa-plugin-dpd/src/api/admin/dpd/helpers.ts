import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type DpdModuleService from "../../../modules/dpd/service"
import { DISPATCH_MAX_SHIPMENTS, LABEL_PAGES, PROTOCOL_MAX_PACKAGES, type LabelPage } from "../../../modules/dpd/lib/constants"
import { courierOrdersOf, type CourierWindow } from "../../../modules/dpd/lib/courier"
import {
  SHIPMENT_GROUPS,
  type ActionResponse,
  type DispatchDto,
  type DispatchResponse,
  type ErrorResponse,
  type EventDto,
  type FieldErrorDto,
  type OptionsSummaryDto,
  type ProblemDto,
  type ShipmentFilter,
  type StatusResponse,
  type WriterDto,
  type WriterKey,
} from "../../../modules/dpd/lib/contract"
import {
  countsOf,
  dispatchCanOrder,
  dispatchShipmentIdsOf,
  toDispatchDto,
  toEventDto,
  toShipmentDto,
  toWriterDto,
  type DispatchRow,
  type EventRow,
  type ShipmentRow,
} from "../../../modules/dpd/lib/dto"
import { pickupAuthOf, type ResolvedDpdOptions } from "../../../modules/dpd/lib/options"
import { secretState } from "../../../modules/dpd/lib/security"
import { DEMO_SEEDED_KEY } from "../../../modules/dpd/lib/settings"
import { WRITERS } from "../../../modules/dpd/lib/writers"
import { KIT_META } from "../../../modules/dpd/lib/kit-meta"
import type { DispatchView } from "../../../workflows/dpd/dispatch"
import { existingProtocolIds, withExistingProtocols } from "../../../workflows/dpd/documents"
import {
  ActionError,
  actorNames,
  dpdService,
  errorText,
  getSetting,
  listEvents,
  listShipments,
  readFulfillments,
  settingsOf,
  storeFor,
  writerStates,
  type Scope,
} from "../../../workflows/dpd/runtime"

/* Only files named `route.ts` register routes; this one is a helper. */

export { dpdService, ActionError }

/** A shipment id of a route: letters, digits and "_" only, at most 64 characters. */
export const SHIPMENT_ID = /^[A-Za-z0-9_]{1,64}$/

/** `Cache-Control: private, no-store` on an answer about one shipment (a plan carries the receiver read live from the order). */
export function noStore(res: MedusaResponse): void {
  const r = res as MedusaResponse & { setHeader?: (name: string, value: string) => unknown }
  if (typeof r.setHeader === "function") r.setHeader("Cache-Control", "private, no-store")
}

/** The `:id` of a shipment route, or a 400 invalid. */
export function shipmentIdOf(req: MedusaRequest): string {
  const id = String((req.params as Record<string, unknown> | undefined)?.id ?? "")
  if (!SHIPMENT_ID.test(id)) throw new ActionError(400, "invalid", "The shipment id is not valid.")
  return id
}

/** The label page of a request body: absent gives null, anything but A4 or LBL_PRINTER a 400 invalid. */
export function pageOf(body: Record<string, unknown>): LabelPage | null {
  const page = body.page
  if (page === undefined || page === null || page === "") return null
  if (typeof page === "string" && (LABEL_PAGES as readonly string[]).includes(page)) return page as LabelPage
  throw new ActionError(400, "invalid", "page is A4 or LBL_PRINTER.")
}

/** The answer of an action route: `{ shipment }` of the row it returns, or the refusal. Private, no-store. */
export async function respondShipment(req: MedusaRequest, res: MedusaResponse, work: () => Promise<ShipmentRow>): Promise<void> {
  noStore(res)
  try {
    const row = await work()
    const body: ActionResponse = { shipment: toShipmentDto(row) }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}

/** The user id of an admin request (who armed a writer). */
export function actorOf(req: MedusaRequest): string | null {
  const ctx = (req as MedusaRequest & { auth_context?: { actor_id?: string | null } }).auth_context
  return typeof ctx?.actor_id === "string" && ctx.actor_id ? ctx.actor_id : null
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const v = Array.isArray(value) ? value[0] : value
  if (v === undefined || v === null || v === "") return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function strParam(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" ? v.trim() : ""
}

/** The JSON body of a request, or an empty object. */
export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}

export function isFilter(v: unknown): v is ShipmentFilter {
  return v === "all" || (typeof v === "string" && (SHIPMENT_GROUPS as readonly string[]).includes(v))
}

/** An ErrorResponse with its status; `problems` only for point_refused (the problems of the chosen point). */
export function refuse(res: MedusaResponse, status: number, code: ErrorResponse["code"], message: string, fields?: ErrorResponse["fields"], problems?: ErrorResponse["problems"]): void {
  const body: ErrorResponse = { code, message, ...(fields && fields.length > 0 ? { fields } : {}), ...(problems && problems.length > 0 ? { problems } : {}) }
  res.status(status).json(body)
}

/**
 * An error as an answer: refusals with their status (and their problems, and
 * Retry-After when the refusal has one), anything else 500 with a plain
 * sentence (the details stay in the log, masked).
 */
export function sendError(scope: Scope, res: MedusaResponse, err: unknown): void {
  if (err instanceof ActionError) {
    const r = res as MedusaResponse & { setHeader?: (name: string, value: string) => unknown }
    if (err.retryAfter !== undefined && typeof r.setHeader === "function") r.setHeader("Retry-After", String(err.retryAfter))
    refuse(res, err.status, err.code, err.message, err.fields, err.problems)
    return
  }
  let svc: DpdModuleService | null = null
  try {
    svc = dpdService(scope)
  } catch {
    svc = null
  }
  const detail = (err as Error)?.stack ?? (err as Error)?.message ?? String(err)
  if (svc) svc.getLogger().error(`[dpd] ${svc.mask(detail)}`)
  refuse(res, 500, "error", "Something went wrong on the server; the details are in the server log.")
}

export async function writersDto(scope: Scope): Promise<Record<WriterKey, WriterDto>> {
  const svc = dpdService(scope)
  const states = await writerStates(svc)
  const names = await actorNames(scope, WRITERS.map((w) => states[w].updatedBy))
  const out = {} as Record<WriterKey, WriterDto>
  for (const w of WRITERS) out[w] = toWriterDto(states[w], names)
  return out
}

export async function eventDtos(scope: Scope, rows: EventRow[]): Promise<EventDto[]> {
  const names = await actorNames(scope, rows.map((r) => r.actor))
  return rows.map((r) => toEventDto(r, names))
}

/** What the admin may know of the options: never a secret, only whether it is set. */
export function optionsSummary(o: ResolvedDpdOptions): OptionsSummaryDto {
  return {
    credentials: {
      login: secretState(o.login),
      password: secretState(o.password),
      infoLogin: secretState(o.infoLogin),
      infoPassword: secretState(o.infoPassword),
      infoChannel: secretState(o.infoChannel),
      pickupLogin: secretState(o.pickupLogin),
      pickupPassword: secretState(o.pickupPassword),
      pickupApiKey: secretState(o.pickupApiKey),
    },
    masterFid: o.masterFid,
    payerFid: o.payerFid,
    trackingMode: o.trackingMode,
    labelPage: o.labelPage,
    countries: [...o.countries],
    codCountries: Object.fromEntries(Object.entries(o.codCountries).map(([country, currencies]) => [country, [...currencies]])),
    codPaymentProviders: [...o.codPaymentProviders],
    internationalReturns: o.internationalReturns,
    weightUnit: o.weightUnit,
    defaultBox: o.defaultBox ? { ...o.defaultBox } : null,
    documentRetentionDays: o.documentRetentionDays,
    autoCreate: o.autoCreate,
    senderLocations: Object.keys(o.senders),
    pickupCheck: o.mode !== "live" ? "catalog" : pickupAuthOf(o).kind !== "none" ? "mypudo" : "not_configured",
    courierOrders: courierOrdersOf(o),
  }
}

/**
 * Status for the admin. READS OUR DATABASE ONLY: not a single call to DPD
 * and not a single write while rendering. Demo mode builds its sample
 * shipments through POST /admin/dpd/demo/seed (the page asks for it).
 */
export async function buildStatus(scope: Scope): Promise<StatusResponse> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const mode = svc.mode()
  const store = storeFor(scope)
  const counts = countsOf(await store.counts(mode), await store.dispatchCounts(mode))
  const settings = await settingsOf(svc)
  const seeded = o.demo ? Boolean(await getSetting(svc, DEMO_SEEDED_KEY)) : false
  return {
    mode,
    demo: o.demo,
    configured: svc.isConfigured(),
    missing: svc.missingOptions(),
    optionProblems: o.problems.map((p) => svc.mask(p)),
    senderProblems: svc.senderProblems().map((p) => ({ code: p.code, path: p.path, ...(p.max !== undefined ? { max: p.max } : {}) })),
    writers: await writersDto(scope),
    counts,
    settings: { labelPage: settings.labelPage, source: { labelPage: settings.source.labelPage } },
    options: optionsSummary(o),
    demoSeeded: seeded,
    version: KIT_META.version,
  }
}

/* ------------------------------------------------------------------ */
/* Dispatches (stage 4)                                                */
/* ------------------------------------------------------------------ */

/** A dispatch id of a route: the shape of SHIPMENT_ID. */
export const DISPATCH_ID = /^[A-Za-z0-9_]{1,64}$/

/** The `:id` of a dispatch route, or a 400 invalid. */
export function dispatchIdOf(req: MedusaRequest): string {
  const id = String((req.params as Record<string, unknown> | undefined)?.id ?? "")
  if (!DISPATCH_ID.test(id)) throw new ActionError(400, "invalid", "The dispatch id is not valid.")
  return id
}

/** shipmentIds of a body: an array of SHIPMENT_ID strings, duplicates dropped (first kept), at most PROTOCOL_MAX_PACKAGES. [] is valid (the plan says no_shipments). */
export function shipmentIdsOf(body: Record<string, unknown>): string[] {
  const raw = body.shipmentIds
  if (!Array.isArray(raw)) throw new ActionError(400, "invalid", "shipmentIds is a list of shipment ids.", [{ index: 0, field: "shipmentIds" }])
  if (raw.length > PROTOCOL_MAX_PACKAGES) {
    throw new ActionError(400, "invalid", `shipmentIds has at most ${PROTOCOL_MAX_PACKAGES} ids.`, [{ index: PROTOCOL_MAX_PACKAGES, field: "shipmentIds" }])
  }
  const bad: FieldErrorDto[] = []
  const out: string[] = []
  raw.forEach((v: unknown, index: number) => {
    if (typeof v !== "string" || !SHIPMENT_ID.test(v)) bad.push({ index, field: "shipmentIds" })
    else if (!out.includes(v)) out.push(v)
  })
  if (bad.length > 0) throw new ActionError(400, "invalid", "A shipment id in shipmentIds is not valid.", bad)
  return out
}

const WINDOW_KEYS = ["pickupDate", "pickupTimeFrom", "pickupTimeTo"] as const

/** CourierOrderRequest from a body: three non-empty strings (trimmed); 400 invalid with the missing keys in fields. The rules of the window are checked by the flow (422 courier_window). */
export function courierWindowOf(body: Record<string, unknown>): CourierWindow {
  const text = (k: (typeof WINDOW_KEYS)[number]): string => {
    const v = body[k]
    return typeof v === "string" ? v.trim() : ""
  }
  const missing = WINDOW_KEYS.filter((k) => text(k) === "")
  if (missing.length > 0) {
    throw new ActionError(400, "invalid", `Missing or not a text: ${missing.join(", ")}.`, missing.map((field) => ({ index: 0, field })))
  }
  return { pickupDate: text("pickupDate"), pickupTimeFrom: text("pickupTimeFrom"), pickupTimeTo: text("pickupTimeTo") }
}

/** The courier order of a demo or sandbox dispatch is simulated (DS4). */
function simulatedOf(row: DispatchRow): boolean {
  return row.mode !== "live"
}

/**
 * E4: the fulfillments of the shipments read now (one call): a canceled one
 * (outside demo also a missing one) is a shipment_canceled problem of that
 * shipment. A read error logs and gives []: the answer never fails on it.
 */
async function shipmentProblemsOf(scope: Scope, view: DispatchView): Promise<ProblemDto[]> {
  if (view.dispatch.state === "canceled" || view.shipments.length === 0) return []
  const svc = dpdService(scope)
  const ids = [...new Set(view.shipments.map((s) => s.fulfillment_id).filter((id): id is string => typeof id === "string" && id.length > 0))].slice(0, DISPATCH_MAX_SHIPMENTS)
  try {
    const current = await readFulfillments(scope, ids)
    const out: ProblemDto[] = []
    for (const s of view.shipments) {
      const f = s.fulfillment_id ? current.get(s.fulfillment_id) : undefined
      if (f ? Boolean(f.canceled_at) : !svc.isDemo()) out.push({ code: "shipment_canceled", field: `shipments.${s.id}` })
    }
    return out
  } catch (err) {
    svc.getLogger().warn(svc.mask(`[dpd] dispatch ${view.dispatch.id}: the fulfillments could not be read for the dispatch view: ${errorText(svc, err)}`))
    return []
  }
}

/** One dispatch with its shipments, the problems of its fulfillments read now (E4), its history, the writers and how courier orders run. */
export async function dispatchResponse(scope: Scope, view: DispatchView): Promise<DispatchResponse> {
  const svc = dpdService(scope)
  const row = withExistingProtocols(view.dispatch, await existingProtocolIds(scope, [view.dispatch.id]))
  const shipmentProblems = await shipmentProblemsOf(scope, view)
  const events = await listEvents(svc, { dispatch_id: row.id }, { take: 100, order: { occurred_at: "DESC" } })
  return {
    dispatch: toDispatchDto(row, view.shipments, { canOrder: dispatchCanOrder(row), simulated: simulatedOf(row), shipmentProblems }),
    events: await eventDtos(scope, events),
    writers: await writersDto(scope),
    courierOrders: courierOrdersOf(svc.getOptions()),
  }
}

/** The answer of a dispatch route: DispatchResponse of the view the work returns, or the refusal. Private, no-store. */
export async function respondDispatch(req: MedusaRequest, res: MedusaResponse, work: () => Promise<DispatchView>): Promise<void> {
  noStore(res)
  try {
    const view = await work()
    res.json(await dispatchResponse(req.scope, view))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}

/** DispatchDto of each row with its current shipments (one listShipments by dispatch_id for all rows); shipmentProblems [] (no fulfillment reads per row, E4). The list, orders/:orderId and withdraw use it. */
export async function dispatchDtos(scope: Scope, rows: readonly DispatchRow[]): Promise<DispatchDto[]> {
  if (rows.length === 0) return []
  const svc = dpdService(scope)
  const ids = rows.map((r) => r.id)
  const shipments = await listShipments(svc, { dispatch_id: ids, mode: svc.mode() }, { take: rows.length * (DISPATCH_MAX_SHIPMENTS + 1) })
  const existing = await existingProtocolIds(scope, ids)
  return rows.map((r) => {
    const row = withExistingProtocols(r, existing)
    const order = dispatchShipmentIdsOf(row.shipment_ids)
    const at = (s: ShipmentRow) => {
      const i = order.indexOf(s.id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    const own = shipments.filter((s) => s.dispatch_id === row.id).sort((a, b) => at(a) - at(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return toDispatchDto(row, own, { canOrder: dispatchCanOrder(row), simulated: simulatedOf(row), shipmentProblems: [] })
  })
}
