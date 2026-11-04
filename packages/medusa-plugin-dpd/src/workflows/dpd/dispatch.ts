/**
 * THE HANDOVER TO THE COURIER (stage 4, DS1). A dispatch (dpd_dispatch)
 * gathers labeled outbound shipments of one sender. Step 1 is the protocol
 * (generateProtocol, writer shipment): the shipments are handed over. Step 2,
 * optional, is the courier order (packagesPickupCall, writer pickup): a
 * physical effect with a cost, never retried and never sent by the pass.
 *
 * Every step that talks to DPD follows one frame (spec 6.2, P1 to P13): the
 * row of the current mode and its shipments read by dispatch_id; a claimed
 * row is busy; the writer and the client; a claim with a token and a lease;
 * the claimed row compared with the one read before (P6); one call, never
 * repeated; the pacing that sent nothing finishes with `unsent`; only the
 * owner of the claim writes anything after the call (P9); an attention code
 * of an ordered row never disappears silently (P10).
 *
 * The handover marker (dpd_handed_over_at in fulfillment.data, DS6) is
 * written before the first protocol, outside demo only (O18), read back
 * before the call, and cleared by the first print's failures only after its
 * finishDispatch returned the row, and only the marker of that print (E18).
 *
 * Neither the checkSum of a courier order nor a receiver's data ever goes to
 * a log, a history row or an answer; the history keeps the codes (P12).
 */

import { randomUUID } from "node:crypto"
import { COURIER_LEASE_MS, DISPATCH_CLAIMED_STATES, DISPATCH_MAX_SHIPMENTS, PACING_MAX_WAIT_MS, PROTOCOL_LEASE_MS, type DispatchState, type DpdMode } from "../../modules/dpd/lib/constants"
import { DISPATCH_ATTENTION_CODES, type AvailabilityResponse, type CourierRangeDto, type CreateDispatchRequest, type FieldErrorDto, type GroupAvailabilityRequest, type ProblemDto, type ResolveDispatchRequest } from "../../modules/dpd/lib/contract"
import { courierDays, courierOrdersOf, courierWindowProblems, validateCourierCall, warsawDate, warsawTime, type CourierWindow } from "../../modules/dpd/lib/courier"
import {
  buildDispatchPlan,
  dispatchPlanHash,
  dispatchReferenceOf,
  dispatchSenderOf,
  markerData,
  orderProblemsOf,
  packagesParamsFrom,
  packagesParamsOf,
  payerFidOf,
  pickupAddressOf,
  pickupCallRequest,
  pickupCallUpdateRequest,
  protocolRequest,
  shipmentBoxesOf,
  type DispatchAction,
  type DispatchPlan,
} from "../../modules/dpd/lib/dispatch"
import type { DispatchUnclear, PickupCallChangeOutcome } from "../../modules/dpd/lib/dpd-answers"
import { nothingSent, type AnyOutcome, type DpdAddress, type DpdPackagesParams, type DpdServicesClient } from "../../modules/dpd/lib/dpdservices"
import { dispatchShipmentIdsOf, dispatchStateOf, hasUsableCheckSum, modeOf, problemsOf, storedProtocolsOf, waybillsOf, type DispatchRow, type ShipmentRow } from "../../modules/dpd/lib/dto"
import { canonicalJson } from "../../modules/dpd/lib/plan"
import { isPickedUp } from "../../modules/dpd/lib/tracking"
import type { DispatchPatch, DpdStore } from "../../modules/dpd/lib/store"
import { clip } from "../../modules/dpd/lib/text"
import type DpdModuleService from "../../modules/dpd/service"
import { mustFind, sourceOf } from "./create"
import { latestLabel, saveProtocol } from "./documents"
import {
  ActionError,
  clearFulfillmentMarkers,
  clientFor,
  dpdService,
  errorText,
  listDispatches,
  listShipments,
  markFulfillments,
  readFulfillments,
  recordEvent,
  requireArmed,
  storeFor,
  type Scope,
} from "./runtime"

export type DispatchInput = { actor: string | null; now?: Date }
export type DispatchView = { dispatch: DispatchRow; shipments: ShipmentRow[] }

/* What a lease expiry leaves (P5): set by the claim, kept by expireDispatchLeases. */
const PROTOCOL_LEASE_ERROR = "Printing the protocol took longer than its lease; print it again."
const ORDER_LEASE_ERROR =
  "No answer from DPD to the courier order within the lease: the courier may have been ordered. Check at DPD, then mark it as ordered or not ordered."
const UPDATE_LEASE_ERROR = "No answer from DPD to the change of the courier order within the lease: check the order at DPD."
const CANCEL_LEASE_ERROR = "No answer from DPD to the cancellation of the courier within the lease: check the order at DPD."

const PROTOCOL_UNSAVED_ERROR = "The protocol came, but it could not be saved; print it again."
const ORDER_CLOSED_ERROR = "The courier is on the way or the order is closed; call DPD."
/** DS13: DPD has the parcel (isPickedUp), so it stays handed over. */
const ALREADY_SHIPPED = "DPD already has this parcel: it cannot be withdrawn, marked do not send or released from the handover."
const MESSAGE_MAX = 1000

const CLAIMED: readonly string[] = DISPATCH_CLAIMED_STATES
const WINDOW_KEYS: readonly string[] = ["pickupDate", "pickupTimeFrom", "pickupTimeTo"]
const AVAILABILITY_REFUSED: readonly string[] = ["range_not_found", "postal_code_not_found", "postal_pattern", "country_not_found"]

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export async function getDispatchOfMode(svc: DpdModuleService, id: string): Promise<DispatchRow | null> {
  const [row] = await listDispatches(svc, { id }, { take: 1 })
  return row && row.mode === svc.mode() ? row : null
}

async function mustDispatch(svc: DpdModuleService, id: string): Promise<DispatchRow> {
  const row = await getDispatchOfMode(svc, id)
  if (!row) throw new ActionError(404, "not_found", "No DPD dispatch with this id in the current mode.")
  return row
}

/** The shipments in the order of shipment_ids (the order of the protocol); others after them, by id. */
function inDispatchOrder(row: DispatchRow, shipments: readonly ShipmentRow[]): ShipmentRow[] {
  const ids = dispatchShipmentIdsOf(row.shipment_ids)
  const at = (s: ShipmentRow) => {
    const i = ids.indexOf(s.id)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...shipments].sort((a, b) => at(a) - at(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** P1: the shipments of a dispatch are the rows pinned to it in the current mode, never the shipment_ids list. */
async function shipmentsOf(svc: DpdModuleService, row: DispatchRow): Promise<ShipmentRow[]> {
  const rows = await listShipments(svc, { dispatch_id: row.id, mode: svc.mode() }, { take: DISPATCH_MAX_SHIPMENTS + 1 })
  return inDispatchOrder(row, rows)
}

/** The row of the current mode and its shipments; 404 not_found otherwise. */
export async function dispatchView(scope: Scope, id: string): Promise<DispatchView> {
  const svc = dpdService(scope)
  const dispatch = await mustDispatch(svc, id)
  return { dispatch, shipments: await shipmentsOf(svc, dispatch) }
}

async function currentShipment(svc: DpdModuleService, s: ShipmentRow): Promise<ShipmentRow> {
  const [row] = await listShipments(svc, { id: s.id }, { take: 1 })
  return row ?? s
}

async function currentDispatch(svc: DpdModuleService, row: DispatchRow): Promise<DispatchRow> {
  return (await getDispatchOfMode(svc, row.id)) ?? row
}

function sortedIds(ids: readonly string[]): string[] {
  return [...ids].sort()
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  const x = sortedIds(a)
  const y = sortedIds(b)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

function fulfillmentIdsOf(shipments: readonly ShipmentRow[]): string[] {
  return [...new Set(shipments.map((s) => s.fulfillment_id).filter((id): id is string => typeof id === "string" && id.length > 0))]
}

/* ------------------------------------------------------------------ */
/* The frame of a step (6.2)                                           */
/* ------------------------------------------------------------------ */

function busyError(): ActionError {
  return new ActionError(409, "busy", "Another process is working on this dispatch; try again in a moment.")
}

function changedError(): ActionError {
  return new ActionError(409, "plan_changed", "The dispatch changed a moment ago; read it again.")
}

/** P2: a claimed row is busy; a state outside `allowed` is wrong_state with its name. */
function requireState(row: DispatchRow, allowed: readonly DispatchState[], own: Partial<Record<DispatchState, string>> = {}): DispatchState {
  const state = dispatchStateOf(row.state)
  if (CLAIMED.includes(state)) throw busyError()
  if (allowed.includes(state)) return state
  const message =
    own[state] ??
    (state === "unknown"
      ? "Resolve the courier order of this dispatch first: mark it as ordered or not ordered."
      : state === "canceled"
        ? "The dispatch is canceled."
        : `Not possible while the dispatch is ${state}.`)
  throw new ActionError(409, "wrong_state", message)
}

function requireClient(scope: Scope, svc: DpdModuleService): DpdServicesClient {
  const client = clientFor(scope)
  if (!client) throw new ActionError(409, "not_configured", `DPD is not configured: ${svc.missingOptions().join(", ")}.`)
  return client
}

/** P4: DEMO_PAYER_FID in demo, else payerFid; none: not_configured. */
function requirePayerFid(svc: DpdModuleService): number {
  const o = svc.getOptions()
  const fid = payerFidOf(o, o.demo)
  if (fid === null) throw new ActionError(409, "not_configured", "DPD is not configured: payerFid is missing.")
  return fid
}

function requireSender(row: DispatchRow) {
  const sender = dispatchSenderOf(row.sender)
  if (!sender) throw new ActionError(409, "wrong_state", "The stored sender of this dispatch cannot be read; cancel the dispatch and create it again.")
  return sender
}

function requireParams(row: DispatchRow): DpdPackagesParams {
  const params = packagesParamsFrom(row.params)
  if (!params) throw new ActionError(409, "wrong_state", "The stored boxes of this dispatch cannot be read; cancel the dispatch and create it again.")
  return params
}

function isAttentionRow(row: Pick<DispatchRow, "state" | "error_code">): boolean {
  return row.state === "ordered" && typeof row.error_code === "string" && DISPATCH_ATTENTION_CODES.includes(row.error_code)
}

/** P10: an ordered row with an attention code keeps it (and its error) on every result that confirmed nothing at DPD. */
function keepAttention(row: DispatchRow, code: string | null, error: string | null): { error: string | null; error_code: string | null } {
  return isAttentionRow(row) ? { error: row.error, error_code: row.error_code } : { error, error_code: code }
}

/** P11: the stored problems without the last DPD refusal; [] is stored as null. */
function problemsWithoutDpd(row: DispatchRow): ProblemDto[] | null {
  const kept = problemsOf(row.problems).filter((p) => p.source !== "dpd")
  return kept.length > 0 ? kept : null
}

/** P11: the stored problems with the problems of this DPD refusal (source "dpd"). */
function problemsWithDpd(row: DispatchRow, dpd: readonly ProblemDto[]): ProblemDto[] | null {
  const all = [...problemsOf(row.problems).filter((p) => p.source !== "dpd"), ...dpd.map((p) => ({ ...p, source: "dpd" as const }))]
  return all.length > 0 ? all : null
}

function masked(svc: DpdModuleService, message: string): string {
  return clip(svc.mask(message), MESSAGE_MAX)
}

/** P7: one call; a throw (never from the client, so a bug) reads as an unclear network answer. */
async function callDpd<T extends AnyOutcome>(svc: DpdModuleService, work: () => Promise<T>): Promise<T | DispatchUnclear> {
  try {
    return await work()
  } catch (err) {
    return { kind: "unclear", code: "network", message: clip(errorText(svc, err), MESSAGE_MAX), traceId: null, httpStatus: 0 }
  }
}

function claimToken(at: Date, leaseMs: number): { token: string; leaseUntil: Date } {
  return { token: randomUUID(), leaseUntil: new Date(at.getTime() + leaseMs) }
}

type EventData = {
  code?: string | null
  httpStatus?: number
  traceId?: string | null
  sent?: boolean
  shipments?: number
  boxes?: number
  weightKg?: number
  documentId?: string | null
  pickupDate?: string | null
  pickupTimeFrom?: string | null
  pickupTimeTo?: string | null
  orderNumber?: string | null
  simulated?: boolean
  outcome?: string
  previous?: string
  markersFailed?: number
}

/** P12: a history row of a dispatch (shipment_id null) or of one of its shipments; data only from the whitelist of EventData. */
async function dispatchEvent(scope: Scope, row: DispatchRow, input: DispatchInput, action: DispatchAction, message: string, data: EventData = {}, shipment?: ShipmentRow): Promise<void> {
  const clean: Record<string, unknown> = { action }
  for (const [k, v] of Object.entries(data)) if (v !== undefined) clean[k] = v
  await recordEvent(scope, {
    shipment_id: shipment?.id ?? null,
    dispatch_id: row.id,
    order_id: shipment?.order_id ?? null,
    kind: "action",
    source: sourceOf(input.actor),
    actor: input.actor,
    message,
    data: clean,
    mode: modeOf(row.mode),
  })
}

function warn(svc: DpdModuleService, id: string, text: string): void {
  svc.getLogger().warn(svc.mask(`[dpd] dispatch ${id}: ${text}`))
}

/**
 * P13: shipments pinned to the dispatch but no longer in shipment_ids (an
 * interrupted withdraw: the dispatch was written, the shipment not released)
 * are released here, before any claim, without DPD. Returns the rest.
 */
async function releaseOrphans(scope: Scope, row: DispatchRow, shipments: readonly ShipmentRow[], input: DispatchInput): Promise<ShipmentRow[]> {
  const ids = dispatchShipmentIdsOf(row.shipment_ids)
  const orphans = shipments.filter((s) => !ids.includes(s.id))
  if (orphans.length === 0) return [...shipments]
  const released = await storeFor(scope).releaseShipments(row.id, orphans.map((s) => s.id))
  const cleared = await clearFulfillmentMarkers(scope, fulfillmentIdsOf(orphans))
  const markersFailed = cleared.failed.length > 0 ? cleared.failed.length : undefined
  for (const s of released) {
    await dispatchEvent(scope, row, input, "shipment_withdrawn", "Released from the dispatch: an earlier withdrawal had already taken it out of the dispatch.", { previous: row.state, outcome: "repaired", markersFailed }, s)
  }
  await dispatchEvent(scope, row, input, "shipment_withdrawn", `${released.length} shipment(s) released: an earlier withdrawal had already taken them out of the dispatch.`, {
    previous: row.state,
    outcome: "repaired",
    shipments: released.length,
    markersFailed,
  })
  const gone = new Set(orphans.map((s) => s.id))
  return shipments.filter((s) => !gone.has(s.id))
}

/**
 * E18: clears only the marker of this print (dpd_dispatch_id and the
 * dpd_handed_over_at of `at`) on the fulfillments it wrote. A read error
 * clears nothing (a marker on pending only blocks the cancel in Medusa; a
 * withdraw, a cancel or the next print repairs it). Demo: never called with
 * anything (markFulfillments wrote nothing, O18).
 */
async function clearOwnMarkers(scope: Scope, dispatchId: string, at: Date, fulfillmentIds: readonly string[]): Promise<void> {
  if (fulfillmentIds.length === 0) return
  const svc = dpdService(scope)
  let current
  try {
    current = await readFulfillments(scope, fulfillmentIds)
  } catch (err) {
    warn(svc, dispatchId, `the handover markers were not cleared, the fulfillments could not be read: ${errorText(svc, err)}`)
    return
  }
  const mine = markerData(dispatchId, at)
  const own = fulfillmentIds.filter((id) => {
    const data = current.get(id)?.data
    return Boolean(data) && data?.dpd_dispatch_id === dispatchId && data?.dpd_handed_over_at === mine.dpd_handed_over_at
  })
  if (own.length > 0) await clearFulfillmentMarkers(scope, own)
}

/** The fields of a courier window refusal: the keys of the body named by the problems. */
function windowFields(problems: readonly ProblemDto[]): FieldErrorDto[] {
  const keys = [...new Set(problems.map((p) => p.field).filter((f): f is string => typeof f === "string" && WINDOW_KEYS.includes(f)))]
  return keys.map((field) => ({ index: 0, field }))
}

function windowError(problems: ProblemDto[]): ActionError {
  return new ActionError(422, "courier_window", "The pickup date or window is not allowed.", windowFields(problems), problems)
}

/** 6.6 point 5: the shape of the window, and a window of today that has already passed (O14). */
function checkWindowShape(window: CourierWindow, now: Date): string {
  const today = warsawDate(now)
  const shape = courierWindowProblems(window, null, today)
  if (shape.length > 0) throw windowError(shape)
  if (window.pickupDate === today && window.pickupTimeTo <= warsawTime(now)) throw windowError([{ code: "date_past", field: "pickupTimeTo" }])
  return today
}

function isPolishAddress(a: DpdAddress | null): a is DpdAddress {
  return a !== null && a.countryCode === "PL" && /^\d{5}$/.test(a.postalCode)
}

function senderNotPl(): ActionError {
  return new ActionError(422, "plan_problems", "The sender needs a Polish postal code for a courier order.", undefined, [{ code: "sender_not_pl", field: "sender.postalCode" }])
}

/** 6.3 points 3 and 4: the ranges of the sender's postal code, read now (DS11). Nothing answered: 503; DPD knows no courier there: 422. */
async function freshRanges(scope: Scope, client: DpdServicesClient, sender: DpdAddress | null): Promise<CourierRangeDto[]> {
  if (!isPolishAddress(sender)) throw senderNotPl()
  const svc = dpdService(scope)
  const outcome = await callDpd(svc, () => client.courierOrderAvailability({ countryCode: "PL", zipCode: sender.postalCode }))
  if (outcome.kind === "ok") return outcome.ranges
  if (nothingSent(outcome)) {
    throw new ActionError(503, "availability_unavailable", "Too many DPD calls right now; nothing was sent. Try again in a moment.", undefined, undefined, Math.ceil(PACING_MAX_WAIT_MS / 1000))
  }
  if (outcome.kind === "refused" && AVAILABILITY_REFUSED.includes(outcome.code)) throw new ActionError(422, "availability_refused", masked(svc, outcome.message))
  throw new ActionError(503, "availability_unavailable", masked(svc, outcome.message))
}

function availabilityAnswer(postalCode: string, ranges: CourierRangeDto[], now: Date, demo: boolean): AvailabilityResponse {
  return { postalCode, countryCode: "PL", ranges, days: courierDays(now), today: warsawDate(now), nowTime: warsawTime(now), simulated: demo }
}

/* ------------------------------------------------------------------ */
/* Plan and create (6.3, 6.4)                                          */
/* ------------------------------------------------------------------ */

/** The rows of the ids, their fulfillments read now, buildDispatchPlan. No writer, no DPD call. */
export async function planDispatch(scope: Scope, shipmentIds: readonly string[], _input: { now?: Date } = {}): Promise<{ plan: DispatchPlan; shipments: ShipmentRow[] }> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const mode = svc.mode()
  const ids = [...new Set(shipmentIds)]
  const rows = ids.length > 0 ? (await listShipments(svc, { id: ids }, { take: ids.length })).filter((r) => r.mode === mode) : []
  const fulfillments = await readFulfillments(scope, fulfillmentIdsOf(rows))
  const inputs = rows.map((row) => {
    const f = row.fulfillment_id ? fulfillments.get(row.fulfillment_id) : undefined
    return { row, fulfillment: f ? { id: f.id, location_id: f.location_id, canceled_at: f.canceled_at } : null }
  })
  const plan = buildDispatchPlan(inputs, { options: o, mode, demo: o.demo, shipmentIds: ids })
  return { plan, shipments: rows }
}

/** Writer shipment (also without print). The plan again, plan_changed on another hash, plan_problems, one store statement; print in the same request (6.4). */
export async function createDispatch(scope: Scope, req: CreateDispatchRequest, input: DispatchInput): Promise<DispatchView> {
  const svc = dpdService(scope)
  const mode = svc.mode()
  await requireArmed(scope, "shipment")
  const { plan } = await planDispatch(scope, req.shipmentIds, { now: input.now })
  if (!plan.ok) throw new ActionError(422, "plan_problems", "The dispatch plan has problems to fix first.", undefined, plan.problems)
  if (plan.hash !== req.planHash) throw new ActionError(409, "plan_changed", "The plan changed since it was read (shipments, sender or boxes); read it again.")
  const problems = [...plan.orderProblems, ...plan.warnings]
  const created = await storeFor(scope).createDispatch(
    {
      mode,
      location_id: plan.locationId,
      sender: plan.sender,
      params: plan.params,
      problems: problems.length > 0 ? problems : null,
      plan_hash: plan.hash,
      order_type: "DOMESTIC",
      created_by: input.actor,
    },
    plan.shipments.map((s) => s.id),
  )
  if (!created) throw new ActionError(409, "plan_changed", "A shipment went into another dispatch or changed its state; read the plan again.")
  const row = created.dispatch
  const shipments = inDispatchOrder(row, created.shipments)
  const params = packagesParamsFrom(row.params)
  const counts: EventData = { shipments: shipments.length, boxes: params?.parcel.count, weightKg: params?.parcel.weight }
  await dispatchEvent(scope, row, input, "dispatch_created", `Dispatch created with ${shipments.length} shipment(s).`, counts)
  for (const s of shipments) await dispatchEvent(scope, row, input, "dispatch_created", "Added to a dispatch.", {}, s)
  if (!req.print) return { dispatch: row, shipments }
  try {
    return await printProtocol(scope, row.id, input)
  } catch (err) {
    /* The dispatch exists: a refused print (ActionError) answers with the dispatch, pending, with the code the print left (6.4 point 10). Anything else is a server error, a 500 like POST .../print. */
    if (!(err instanceof ActionError)) throw err
    warn(svc, row.id, `created, but the protocol was not printed: ${errorText(svc, err)}`)
    return dispatchView(scope, row.id)
  }
}

/* ------------------------------------------------------------------ */
/* The protocol (6.5)                                                  */
/* ------------------------------------------------------------------ */

/** 6.5 point 3: a shipment that can no longer be listed in the protocol, by the codes of candidateProblems. */
function protocolShipmentProblems(shipments: readonly ShipmentRow[], first: boolean, demo: boolean): ProblemDto[] {
  const out: ProblemDto[] = []
  for (const s of shipments) {
    const field = `shipments.${s.id}`
    if (s.kind !== "outbound") out.push({ code: "shipment_not_outbound", field })
    if (s.state !== "labeled") out.push({ code: s.state === "excluded" ? "shipment_excluded" : "shipment_not_labeled", field, detail: s.state })
    if (s.session_type && s.session_type !== "DOMESTIC") out.push({ code: "shipment_not_domestic", field, detail: s.session_type })
    if (dispatchReferenceOf(s, demo) === null) out.push({ code: "shipment_no_reference", field })
    if (first && s.handed_over_at) out.push({ code: "shipment_dispatched", field, detail: "handed_over" })
  }
  return out
}

/** pending (first print) or printed | ordered (reprint): claim printing, markers and canceled_at read again (first print outside demo, DS6, O18), generateProtocol, saveProtocol, markHandedOver; writer shipment. */
export async function printProtocol(scope: Scope, id: string, input: DispatchInput): Promise<DispatchView> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const store = storeFor(scope)
  const at = input.now ?? new Date()
  const row = await mustDispatch(svc, id)
  const state = requireState(row, ["pending", "printed", "ordered"])
  const first = state === "pending"
  await requireArmed(scope, "shipment")
  const client = requireClient(scope, svc)
  const payerFid = requirePayerFid(svc)

  /* 3. The shipments (after P13). */
  const shipments = await releaseOrphans(scope, row, await shipmentsOf(svc, row), input)
  if (shipments.length === 0) throw new ActionError(409, "wrong_state", "The dispatch has no shipments.")
  const notReady = protocolShipmentProblems(shipments, first, o.demo)
  if (notReady.length > 0) {
    throw new ActionError(409, "plan_changed", "A shipment of the dispatch is no longer ready for the protocol; withdraw it or read the dispatch again.", undefined, notReady)
  }

  /* 4. The fulfillments, read now: a canceled (or, outside demo, missing) one never goes into a protocol. */
  const fulfillmentIds = fulfillmentIdsOf(shipments)
  const fulfillments = await readFulfillments(scope, fulfillmentIds)
  const canceled: ProblemDto[] = []
  for (const s of shipments) {
    const f = s.fulfillment_id ? fulfillments.get(s.fulfillment_id) : undefined
    if (f ? Boolean(f.canceled_at) : !o.demo) canceled.push({ code: "shipment_canceled", field: `shipments.${s.id}` })
  }
  if (canceled.length > 0) throw new ActionError(409, "plan_changed", "A fulfillment of the dispatch was canceled in Medusa; withdraw its shipment from the dispatch.", undefined, canceled)

  /* 5. The request. */
  const sender = requireSender(row)
  const references = shipments.map((s) => dispatchReferenceOf(s, o.demo)).filter((r): r is string => r !== null)
  const request = protocolRequest(references, pickupAddressOf(sender, payerFid))

  /* 6. The claim (P5) and the compare (P6: the list only). */
  const attention = keepAttention(row, "protocol_unclear", PROTOCOL_LEASE_ERROR)
  const { token, leaseUntil } = claimToken(at, PROTOCOL_LEASE_MS)
  const claimed = await store.claimDispatch(row.id, [state], { token, leaseUntil, to: "printing", patch: { ...attention, updated_by: input.actor }, expect: { error_code: row.error_code } })
  if (!claimed) throw await lostTransition(svc, row)
  if (!sameList(dispatchShipmentIdsOf(claimed.shipment_ids), shipments.map((s) => s.id))) {
    await store.finishDispatch(row.id, token, { state, ...keepAttention(row, null, null) }, { unsent: {} })
    throw changedError()
  }

  /* 7 and 8. The marker before the call (first print, sandbox and live only). */
  let written: string[] = []
  if (first && !o.demo) {
    const marker = markerData(row.id, at)
    const marked = await markFulfillments(scope, fulfillmentIds, marker)
    written = marked.written
    if (marked.failed.length > 0 || marked.missing.length > 0) {
      const detail = [...marked.missing.map((f) => `${f}: not found`), ...marked.failed.map((f) => `${f.fulfillmentId}: ${f.message}`)].join("; ")
      const finished = await store.finishDispatch(row.id, token, { state: "pending", error: masked(svc, `The handover marker could not be written (${detail}).`), error_code: "marker_failed" }, { unsent: {} })
      if (!finished) return dispatchView(scope, id)
      await clearOwnMarkers(scope, row.id, at, written)
      await dispatchEvent(scope, row, input, "protocol_refused", "The handover marker could not be written to every fulfillment; nothing was sent to DPD.", { code: "marker_failed", sent: false })
      throw new ActionError(503, "marker_failed", "The handover marker could not be written to every fulfillment; nothing was sent to DPD. Try again.")
    }
    let again: Map<string, { canceled_at: string | Date | null; data: Record<string, unknown> | null }> | null = null
    try {
      again = await readFulfillments(scope, fulfillmentIds)
    } catch (err) {
      warn(svc, row.id, `the fulfillments could not be read after the marker: ${errorText(svc, err)}`)
    }
    const gone: ProblemDto[] = []
    let ownMissing = again === null
    for (const s of shipments) {
      const f = s.fulfillment_id && again ? again.get(s.fulfillment_id) : undefined
      if (again && (!f || f.canceled_at)) gone.push({ code: "shipment_canceled", field: `shipments.${s.id}` })
      else if (f && (f.data?.dpd_dispatch_id !== row.id || f.data?.dpd_handed_over_at !== marker.dpd_handed_over_at)) ownMissing = true
    }
    if (gone.length > 0 || ownMissing) {
      const code = gone.length > 0 ? "plan_changed" : "marker_failed"
      const error = gone.length > 0 ? "A fulfillment was canceled while the handover was being marked; nothing was sent to DPD." : "The handover marker was gone before the protocol; nothing was sent to DPD."
      const finished = await store.finishDispatch(row.id, token, { state: "pending", error, error_code: code }, { unsent: {} })
      if (!finished) return dispatchView(scope, id)
      await clearOwnMarkers(scope, row.id, at, written)
      await dispatchEvent(scope, row, input, "protocol_refused", error, { code, sent: false })
      if (gone.length > 0) throw new ActionError(409, "plan_changed", "A fulfillment of the dispatch was canceled in Medusa; withdraw its shipment from the dispatch.", undefined, gone)
      throw new ActionError(503, "marker_failed", "The handover marker could not be confirmed on every fulfillment; nothing was sent to DPD. Try again.")
    }
  }

  /* 9. One call (P7). */
  const outcome = await callDpd(svc, () => client.generateProtocol(request))
  const clearMine = async () => {
    if (first) await clearOwnMarkers(scope, row.id, at, written)
  }

  /* 10. The pacing sent nothing (P8). */
  if (nothingSent(outcome)) {
    const finished = await store.finishDispatch(row.id, token, { state, ...keepAttention(row, "rate_limited", masked(svc, outcome.kind === "ok" ? "" : outcome.message)) }, { unsent: {} })
    if (!finished) return dispatchView(scope, id)
    await clearMine()
    await dispatchEvent(scope, row, input, "protocol_refused", "Too many DPD calls right now; nothing was sent. Print the protocol again in a moment.", { code: "rate_limited", sent: false })
    return dispatchView(scope, id)
  }

  /* 11. ok: the document inside the claim, then the result. */
  if (outcome.kind === "ok") {
    let doc
    try {
      doc = await saveProtocol(scope, claimed, { pdfBase64: outcome.pdfBase64, documentId: outcome.documentId, actor: input.actor })
    } catch (err) {
      warn(svc, row.id, `the protocol came but could not be saved: ${errorText(svc, err)}`)
      const finished = await store.finishDispatch(row.id, token, { state, ...keepAttention(row, "protocol_unclear", PROTOCOL_UNSAVED_ERROR) })
      if (!finished) return dispatchView(scope, id)
      await clearMine()
      await dispatchEvent(scope, row, input, "protocol_unclear", PROTOCOL_UNSAVED_ERROR, { traceId: outcome.traceId, sent: true })
      return dispatchView(scope, id)
    }
    const protocols = [...storedProtocolsOf(claimed.protocols), { docId: doc.id, documentId: outcome.documentId, at: at.toISOString(), shipmentIds: shipments.map((s) => s.id) }]
    const finished = await store.finishDispatch(row.id, token, {
      state: state === "ordered" ? "ordered" : "printed",
      protocols,
      protocol_at: row.protocol_at ?? at,
      problems: problemsWithoutDpd(claimed),
      ...keepAttention(row, null, null),
      updated_by: input.actor,
    })
    if (!finished) return dispatchView(scope, id)
    try {
      await store.markHandedOver(row.id, at)
    } catch (err) {
      warn(svc, row.id, `the shipments were not marked as handed over: ${errorText(svc, err)}`)
    }
    const action: DispatchAction = first ? "protocol_printed" : "protocol_reprinted"
    await dispatchEvent(scope, row, input, action, first ? "Protocol printed: the shipments are handed over." : "Protocol printed again.", {
      documentId: outcome.documentId,
      shipments: shipments.length,
      traceId: outcome.traceId,
      sent: true,
    })
    if (first) for (const s of shipments) await dispatchEvent(scope, row, input, "handed_over", "Handed over to DPD with the protocol.", { documentId: outcome.documentId }, s)
    return dispatchView(scope, id)
  }

  /* 12 and 13. A refusal or an unclear answer: the state before the claim, the first print's markers cleared after the finish. */
  const refused = outcome.kind === "refused"
  const finished = await store.finishDispatch(row.id, token, {
    state,
    ...keepAttention(row, refused ? outcome.code : "protocol_unclear", masked(svc, outcome.message)),
    ...(refused ? { problems: problemsWithDpd(claimed, outcome.problems) } : {}),
  })
  if (!finished) return dispatchView(scope, id)
  await clearMine()
  const data: EventData = { code: outcome.code, httpStatus: outcome.httpStatus, traceId: outcome.traceId, sent: true }
  if (refused) await dispatchEvent(scope, row, input, "protocol_refused", masked(svc, outcome.message), data)
  else {
    warn(svc, row.id, `no clear answer to the protocol (${outcome.code}, trace ${outcome.traceId ?? "none"}).`)
    await dispatchEvent(scope, row, input, "protocol_unclear", masked(svc, outcome.message), data)
  }
  return dispatchView(scope, id)
}

/* ------------------------------------------------------------------ */
/* Availability (6.3, 13.1a)                                           */
/* ------------------------------------------------------------------ */

/** A dispatch in printed or ordered (O15): availability for the sender postal code of the dispatch, read now (DS11); a configured client, no writer, nothing stored. */
export async function courierAvailability(scope: Scope, id: string, input: { now?: Date } = {}): Promise<AvailabilityResponse> {
  const svc = dpdService(scope)
  const now = input.now ?? new Date()
  const row = await mustDispatch(svc, id)
  requireState(row, ["printed", "ordered"])
  const client = requireClient(scope, svc)
  const sender = requireSender(row)
  const ranges = await freshRanges(scope, client, sender.address)
  return availabilityAnswer(sender.address.postalCode, ranges, now, svc.getOptions().demo)
}

/** Before the dispatch exists (13.1a): the plan of the ids, its group with this key (404 otherwise), its sender's postal code, then as courierAvailability. No writer, no write, no event. */
export async function groupAvailability(scope: Scope, req: GroupAvailabilityRequest, input: { now?: Date } = {}): Promise<AvailabilityResponse> {
  const svc = dpdService(scope)
  const now = input.now ?? new Date()
  const { plan } = await planDispatch(scope, req.shipmentIds, { now })
  const group = plan.groups.find((g) => g.key === req.groupKey)
  if (!group) throw new ActionError(404, "not_found", "This sender group is not in the plan of these shipments.")
  if (!isPolishAddress(group.sender)) throw senderNotPl()
  const client = requireClient(scope, svc)
  const ranges = await freshRanges(scope, client, group.sender)
  return availabilityAnswer(group.sender.postalCode, ranges, now, svc.getOptions().demo)
}

/* ------------------------------------------------------------------ */
/* The courier (6.6 to 6.8)                                            */
/* ------------------------------------------------------------------ */

const CLEARED_WINDOW: Omit<DispatchPatch, "state"> = { pickup_date: null, pickup_time_from: null, pickup_time_to: null, order_type: null }
const CLEARED_ORDER: Omit<DispatchPatch, "state"> = { ...CLEARED_WINDOW, order_number: null, check_sum: null, ordered_at: null }

function noCheckSum(): ActionError {
  return new ActionError(409, "no_check_sum", "This courier order has no checkSum: change or cancel it in the DPD panel or by phone.")
}

/**
 * finishDispatch after DPD confirmed a courier call. A database error is held, not thrown at
 * once: the caller first records what DPD confirmed (the order number), because the lease pass
 * leaves the row unknown or with an attention code and a person resolves it with that number
 * (P9, 6.11). The caller rethrows the error afterwards, so the route still answers 500.
 */
async function finishConfirmed(store: DpdStore, id: string, token: string, patch: DispatchPatch & { state: DispatchState }): Promise<{ finished: DispatchRow | null; failure: { error: unknown } | null }> {
  try {
    return { finished: await store.finishDispatch(id, token, patch), failure: null }
  } catch (error) {
    return { finished: null, failure: { error } }
  }
}

/** A PATCH or DELETE confirmed by DPD whose finishDispatch threw: the history keeps the order number DPD answered with, under the unclear action the lease pass ends in (P5). */
async function recordUnsavedChange(scope: Scope, row: DispatchRow, input: DispatchInput, op: "update" | "delete", orderNumber: string | null, traceId: string | null, error: unknown): Promise<void> {
  const svc = dpdService(scope)
  const what = op === "update" ? "changed" : "canceled"
  warn(svc, row.id, `DPD ${what} the courier order${orderNumber ? ` ${orderNumber}` : ""}, but the dispatch could not be saved: ${errorText(svc, error)}`)
  const message = `DPD ${what} the courier order, but the dispatch could not be saved; check the order at DPD.`
  await dispatchEvent(scope, row, input, op === "update" ? "courier_update_unclear" : "courier_cancel_unclear", message, { orderNumber, traceId, sent: true })
}

/** printed: availability fresh, the window in the ranges, claim ordering, pickupCallCreate once, never retried (DS7); writer pickup. */
export async function orderCourier(scope: Scope, id: string, window: CourierWindow, input: DispatchInput): Promise<DispatchView> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const store = storeFor(scope)
  const at = input.now ?? new Date()
  const row = await mustDispatch(svc, id)
  requireState(row, ["printed"], { ordered: "The courier is already ordered for this dispatch." })
  await requireArmed(scope, "pickup")
  const client = requireClient(scope, svc)
  const payerFid = requirePayerFid(svc)
  const shipments = await releaseOrphans(scope, row, await shipmentsOf(svc, row), input)
  const sender = requireSender(row)
  const params = requireParams(row)
  const blockers = orderProblemsOf(sender, params)
  if (blockers.length > 0) throw new ActionError(422, "plan_problems", "The courier cannot be ordered for this dispatch.", undefined, blockers)
  const today = checkWindowShape(window, at)
  const ranges = await freshRanges(scope, client, sender.address)
  const outside = courierWindowProblems(window, ranges, today)
  if (outside.length > 0) throw windowError(outside)
  const body = pickupCallRequest({ window, sender, params, payerFid })
  const refusal = validateCourierCall(body, { today, payerFid, op: "create" })
  if (refusal) throw new ActionError(422, "plan_problems", refusal.message, undefined, refusal.problems)

  const { token, leaseUntil } = claimToken(at, COURIER_LEASE_MS)
  const claimed = await store.claimDispatch(row.id, ["printed"], {
    token,
    leaseUntil,
    to: "ordering",
    patch: {
      pickup_date: window.pickupDate,
      pickup_time_from: window.pickupTimeFrom,
      pickup_time_to: window.pickupTimeTo,
      order_type: "DOMESTIC",
      error: ORDER_LEASE_ERROR,
      error_code: "order_unclear",
      updated_by: input.actor,
    },
    expect: { error_code: row.error_code },
  })
  if (!claimed) throw await lostTransition(svc, row)
  if (!sameList(dispatchShipmentIdsOf(claimed.shipment_ids), shipments.map((s) => s.id)) || canonicalJson(claimed.params) !== canonicalJson(row.params)) {
    await store.finishDispatch(row.id, token, { state: "printed", ...CLEARED_WINDOW, error: null, error_code: null }, { unsent: {} })
    throw changedError()
  }

  const outcome = await callDpd(svc, () => client.pickupCallCreate(body))
  const simulated = courierOrdersOf(o) !== "dpd"
  const windowData: EventData = { pickupDate: window.pickupDate, pickupTimeFrom: window.pickupTimeFrom, pickupTimeTo: window.pickupTimeTo }
  if (nothingSent(outcome)) {
    const finished = await store.finishDispatch(row.id, token, { state: "printed", ...CLEARED_WINDOW, error: masked(svc, outcome.kind === "ok" ? "" : outcome.message), error_code: "rate_limited" }, { unsent: {} })
    if (!finished) return dispatchView(scope, id)
    await dispatchEvent(scope, row, input, "courier_refused", "Too many DPD calls right now; nothing was sent. Order the courier again in a moment.", { code: "rate_limited", sent: false })
    return dispatchView(scope, id)
  }
  if (outcome.kind === "ok") {
    const saved = await finishConfirmed(store, row.id, token, {
      state: "ordered",
      order_number: outcome.orderNumber,
      check_sum: outcome.checkSum,
      ordered_at: at,
      problems: problemsWithoutDpd(claimed),
      error: null,
      error_code: null,
    })
    /* Logged and recorded even when the lease ran out meanwhile or the finish threw (P9): the number is what a person resolves the unknown row with. */
    svc.getLogger().info(svc.mask(`[dpd] dispatch ${row.id}: courier ordered, order number ${outcome.orderNumber}${simulated ? " (simulated)" : ""}.`))
    if (saved.failure) warn(svc, row.id, `the courier order ${outcome.orderNumber} could not be saved: ${errorText(svc, saved.failure.error)}`)
    await dispatchEvent(scope, row, input, "courier_ordered", `Courier ordered, order number ${outcome.orderNumber}.`, {
      ...windowData,
      orderNumber: outcome.orderNumber,
      boxes: params.parcel.count,
      simulated,
      traceId: outcome.traceId,
      sent: true,
    })
    if (saved.failure) throw saved.failure.error
    return dispatchView(scope, id)
  }
  const data: EventData = { ...windowData, code: outcome.code, httpStatus: outcome.httpStatus, traceId: outcome.traceId, simulated, sent: true }
  if (outcome.kind === "refused") {
    const finished = await store.finishDispatch(row.id, token, {
      state: "printed",
      ...CLEARED_WINDOW,
      error: masked(svc, outcome.message),
      error_code: outcome.code,
      problems: problemsWithDpd(claimed, outcome.problems),
    })
    if (!finished) return dispatchView(scope, id)
    await dispatchEvent(scope, row, input, "courier_refused", masked(svc, outcome.message), data)
    return dispatchView(scope, id)
  }
  const finished = await store.finishDispatch(row.id, token, { state: "unknown", error: masked(svc, outcome.message), error_code: "order_unclear" })
  if (!finished) return dispatchView(scope, id)
  warn(svc, row.id, `no clear answer to the courier order (${outcome.code}, trace ${outcome.traceId ?? "none"}); a person resolves it.`)
  await dispatchEvent(scope, row, input, "courier_unknown", masked(svc, outcome.message), data)
  return dispatchView(scope, id)
}

/**
 * The stored window and order of an ordered row, as they were read before the claim (P6 with E5).
 * The window too: DPD may keep the checkSum on a PATCH (DS13 [NZ]), so a reschedule finished between
 * a withdraw's read and its claim would otherwise be sent back to DPD with the old window.
 */
function sameOrder(claimed: DispatchRow, row: DispatchRow): boolean {
  return (
    claimed.check_sum === row.check_sum &&
    claimed.order_number === row.order_number &&
    claimed.pickup_date === row.pickup_date &&
    claimed.pickup_time_from === row.pickup_time_from &&
    claimed.pickup_time_to === row.pickup_time_to
  )
}

/** ordered with a checkSum: availability fresh, claim updating, PATCH (DS13); writer pickup. */
export async function rescheduleCourier(scope: Scope, id: string, window: CourierWindow, input: DispatchInput): Promise<DispatchView> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const store = storeFor(scope)
  const at = input.now ?? new Date()
  const row = await mustDispatch(svc, id)
  requireState(row, ["ordered"])
  if (!hasUsableCheckSum(row)) throw noCheckSum()
  await requireArmed(scope, "pickup")
  const client = requireClient(scope, svc)
  const payerFid = requirePayerFid(svc)
  const shipments = await releaseOrphans(scope, row, await shipmentsOf(svc, row), input)
  const sender = requireSender(row)
  const params = requireParams(row)
  if (window.pickupDate === row.pickup_date && window.pickupTimeFrom === row.pickup_time_from && window.pickupTimeTo === row.pickup_time_to) return dispatchView(scope, id)
  const today = checkWindowShape(window, at)
  const ranges = await freshRanges(scope, client, sender.address)
  const outside = courierWindowProblems(window, ranges, today)
  if (outside.length > 0) throw windowError(outside)
  const orderNumber = row.order_number ?? ""
  const checkSum = row.check_sum ?? ""
  const body = pickupCallUpdateRequest({ orderNumber, checkSum, window, sender, params })
  const refusal = validateCourierCall(body, { today, payerFid, op: "update" })
  if (refusal) throw new ActionError(422, "plan_problems", refusal.message, undefined, refusal.problems)

  const { token, leaseUntil } = claimToken(at, COURIER_LEASE_MS)
  const claimed = await store.claimDispatch(row.id, ["ordered"], {
    token,
    leaseUntil,
    to: "updating",
    patch: { error: UPDATE_LEASE_ERROR, error_code: "update_unclear", updated_by: input.actor },
    expect: { error_code: row.error_code },
  })
  if (!claimed) throw await lostTransition(svc, row)
  if (
    !sameList(dispatchShipmentIdsOf(claimed.shipment_ids), shipments.map((s) => s.id)) ||
    canonicalJson(claimed.params) !== canonicalJson(row.params) ||
    !sameOrder(claimed, row)
  ) {
    await store.finishDispatch(row.id, token, { state: "ordered", ...keepAttention(row, null, null) }, { unsent: {} })
    throw changedError()
  }

  const outcome = await callDpd(svc, () => client.pickupCallUpdate(body))
  const simulated = courierOrdersOf(o) !== "dpd"
  const windowData: EventData = { pickupDate: window.pickupDate, pickupTimeFrom: window.pickupTimeFrom, pickupTimeTo: window.pickupTimeTo }
  if (nothingSent(outcome)) {
    const finished = await store.finishDispatch(row.id, token, { state: "ordered", ...keepAttention(row, "rate_limited", masked(svc, outcome.kind === "ok" ? "" : outcome.message)) }, { unsent: {} })
    if (!finished) return dispatchView(scope, id)
    await dispatchEvent(scope, row, input, "courier_update_refused", "Too many DPD calls right now; nothing was sent. Change the pickup again in a moment.", { code: "rate_limited", sent: false })
    return dispatchView(scope, id)
  }
  if (outcome.kind === "ok") {
    const saved = await finishConfirmed(store, row.id, token, {
      state: "ordered",
      pickup_date: window.pickupDate,
      pickup_time_from: window.pickupTimeFrom,
      pickup_time_to: window.pickupTimeTo,
      order_number: outcome.orderNumber ?? row.order_number,
      check_sum: outcome.checkSum ?? row.check_sum,
      problems: problemsWithoutDpd(claimed),
      error: null,
      error_code: null,
    })
    if (saved.failure) {
      await recordUnsavedChange(scope, row, input, "update", outcome.orderNumber ?? row.order_number, outcome.traceId, saved.failure.error)
      throw saved.failure.error
    }
    const finished = saved.finished
    if (!finished) return dispatchView(scope, id)
    await dispatchEvent(scope, row, input, "courier_rescheduled", "The courier pickup was changed.", {
      ...windowData,
      orderNumber: finished.order_number,
      simulated,
      traceId: outcome.traceId,
      sent: true,
    })
    return dispatchView(scope, id)
  }
  return finishChangeFailure(scope, row, token, input, outcome, "update", claimed)
}

/** ordered with a checkSum: claim updating, DELETE, printed on ok (DS14); writer pickup. */
export async function cancelCourier(scope: Scope, id: string, input: DispatchInput): Promise<DispatchView> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const store = storeFor(scope)
  const at = input.now ?? new Date()
  const row = await mustDispatch(svc, id)
  requireState(row, ["ordered"])
  if (!hasUsableCheckSum(row)) throw noCheckSum()
  await requireArmed(scope, "pickup")
  const client = requireClient(scope, svc)
  const payerFid = requirePayerFid(svc)
  const query = { orderNumber: row.order_number ?? "", checkSum: row.check_sum ?? "" }
  if (validateCourierCall(query, { today: warsawDate(at), payerFid, op: "delete" })) throw noCheckSum()

  const { token, leaseUntil } = claimToken(at, COURIER_LEASE_MS)
  const claimed = await store.claimDispatch(row.id, ["ordered"], {
    token,
    leaseUntil,
    to: "updating",
    patch: { error: CANCEL_LEASE_ERROR, error_code: "cancel_unclear", updated_by: input.actor },
    expect: { error_code: row.error_code },
  })
  if (!claimed) throw await lostTransition(svc, row)
  if (!sameOrder(claimed, row)) {
    await store.finishDispatch(row.id, token, { state: "ordered", ...keepAttention(row, null, null) }, { unsent: {} })
    throw changedError()
  }

  const outcome = await callDpd(svc, () => client.pickupCallDelete(query))
  if (nothingSent(outcome)) {
    const finished = await store.finishDispatch(row.id, token, { state: "ordered", ...keepAttention(row, "rate_limited", masked(svc, outcome.kind === "ok" ? "" : outcome.message)) }, { unsent: {} })
    if (!finished) return dispatchView(scope, id)
    await dispatchEvent(scope, row, input, "courier_cancel_refused", "Too many DPD calls right now; nothing was sent. Cancel the courier again in a moment.", { code: "rate_limited", sent: false })
    return dispatchView(scope, id)
  }
  if (outcome.kind === "ok") {
    const saved = await finishConfirmed(store, row.id, token, { state: "printed", ...CLEARED_ORDER, problems: problemsWithoutDpd(claimed), error: null, error_code: null })
    if (saved.failure) {
      await recordUnsavedChange(scope, row, input, "delete", row.order_number, outcome.traceId, saved.failure.error)
      throw saved.failure.error
    }
    if (!saved.finished) return dispatchView(scope, id)
    await dispatchEvent(scope, row, input, "courier_canceled", "The courier was canceled; the shipments stay handed over and another courier can be ordered.", {
      orderNumber: row.order_number,
      simulated: courierOrdersOf(o) !== "dpd",
      traceId: outcome.traceId,
      sent: true,
    })
    return dispatchView(scope, id)
  }
  return finishChangeFailure(scope, row, token, input, outcome, "delete", claimed)
}

/** A refused or unclear PATCH or DELETE: the row stays ordered (P10, 6.7 points 11 and 12, 6.8 points 8 and 9). */
async function finishChangeFailure(
  scope: Scope,
  row: DispatchRow,
  token: string,
  input: DispatchInput,
  outcome: { kind: "refused"; code: string; message: string; problems: ProblemDto[]; traceId: string | null; httpStatus: number } | DispatchUnclear,
  op: "update" | "delete",
  claimed: DispatchRow,
): Promise<DispatchView> {
  const svc = dpdService(scope)
  const store = storeFor(scope)
  const data: EventData = { code: outcome.code, httpStatus: outcome.httpStatus, traceId: outcome.traceId, sent: true }
  if (outcome.kind === "refused") {
    const error = outcome.code === "order_closed" ? ORDER_CLOSED_ERROR : masked(svc, outcome.message)
    const finished = await store.finishDispatch(row.id, token, { state: "ordered", ...keepAttention(row, outcome.code, error), problems: problemsWithDpd(claimed, outcome.problems) })
    if (finished) await dispatchEvent(scope, row, input, op === "update" ? "courier_update_refused" : "courier_cancel_refused", error, data)
    return dispatchView(scope, row.id)
  }
  const code = op === "update" ? "update_unclear" : "cancel_unclear"
  const finished = await store.finishDispatch(row.id, token, { state: "ordered", error: masked(svc, outcome.message), error_code: code })
  if (finished) {
    warn(svc, row.id, `no clear answer to the ${op === "update" ? "change" : "cancellation"} of the courier order (${outcome.code}, trace ${outcome.traceId ?? "none"}); check the order at DPD.`)
    await dispatchEvent(scope, row, input, op === "update" ? "courier_update_unclear" : "courier_cancel_unclear", masked(svc, outcome.message), data)
  }
  return dispatchView(scope, row.id)
}

/* ------------------------------------------------------------------ */
/* Resolve and cancel (6.10, 6.11)                                     */
/* ------------------------------------------------------------------ */

/** The order number of a resolve: trimmed, "" as none; 400 invalid for another shape or with not_ordered. */
function resolvedOrderNumber(req: ResolveDispatchRequest): string | null {
  const raw = typeof req.orderNumber === "string" ? req.orderNumber.trim() : ""
  if (raw === "") return null
  if (req.outcome !== "ordered" || !/^[A-Za-z0-9-]{1,64}$/.test(raw)) {
    throw new ActionError(400, "invalid", "The order number is 1 to 64 letters, digits or dashes, and only with the outcome ordered.", [{ index: 0, field: "orderNumber" }])
  }
  return raw
}

/** After a lost transition: busy while claimed, else plan_changed. */
async function lostTransition(svc: DpdModuleService, row: DispatchRow): Promise<ActionError> {
  const again = await getDispatchOfMode(svc, row.id)
  return again && CLAIMED.includes(again.state) ? busyError() : changedError()
}

/** unknown, ordered with an attention code (O13, O17), or ordered without a usable checkSum (O16): ordered or not_ordered, local; writer pickup. */
export async function resolveDispatch(scope: Scope, id: string, req: ResolveDispatchRequest, input: DispatchInput): Promise<DispatchView> {
  const svc = dpdService(scope)
  const store = storeFor(scope)
  const at = input.now ?? new Date()
  if (req.outcome !== "ordered" && req.outcome !== "not_ordered") throw new ActionError(400, "invalid", "outcome is ordered or not_ordered.", [{ index: 0, field: "outcome" }])
  const orderNumber = resolvedOrderNumber(req)
  const row = await mustDispatch(svc, id)
  const state = requireState(row, ["unknown", "ordered"])
  if (state === "ordered" && !isAttentionRow(row) && hasUsableCheckSum(row)) {
    throw new ActionError(409, "wrong_state", "This courier order has a checkSum and no open question: change or cancel the courier instead.")
  }
  await requireArmed(scope, "pickup")
  const notOrdered: DispatchPatch = { state: "printed", ...CLEARED_ORDER, error: null, error_code: null, updated_by: input.actor }
  let moved: DispatchRow | null
  if (state === "unknown") {
    const patch: DispatchPatch =
      req.outcome === "ordered" ? { state: "ordered", order_number: orderNumber, check_sum: null, ordered_at: at, error: null, error_code: null, updated_by: input.actor } : notOrdered
    moved = await store.transitionDispatch(row.id, ["unknown"], patch)
  } else {
    /* O19: only the row as it was read; a PATCH that cleared the code meanwhile makes this plan_changed. */
    const expect = { error_code: row.error_code, order_number: row.order_number, check_sum_set: row.check_sum !== null }
    const renumbered = orderNumber !== null && orderNumber !== row.order_number
    const patch: DispatchPatch =
      req.outcome === "ordered" ? { error: null, error_code: null, updated_by: input.actor, ...(renumbered ? { order_number: orderNumber, check_sum: null } : {}) } : notOrdered
    moved = await store.transitionDispatch(row.id, ["ordered"], patch, expect)
  }
  if (!moved) throw await lostTransition(svc, row)
  const message =
    req.outcome === "ordered"
      ? `Resolved by a person: the courier is ordered${orderNumber ? `, order number ${orderNumber}` : ""}.`
      : "Resolved by a person: there is no courier order at DPD; another courier can be ordered."
  await dispatchEvent(scope, row, input, "dispatch_resolved", message, { outcome: req.outcome, previous: state, orderNumber: orderNumber ?? undefined })
  return dispatchView(scope, id)
}

/** pending | printed: canceled, every shipment released, markers cleared (DS14). Local; writer shipment. */
export async function cancelDispatch(scope: Scope, id: string, input: DispatchInput): Promise<DispatchView> {
  const svc = dpdService(scope)
  const store = storeFor(scope)
  const row = await mustDispatch(svc, id)
  const state = requireState(row, ["pending", "printed"], {
    ordered: hasUsableCheckSum(row)
      ? "Cancel the courier first."
      : "Call the courier off at DPD, then resolve the order as not ordered: the plugin has no checkSum to cancel it.",
  })
  await requireArmed(scope, "shipment")
  /* DS13, O43: a parcel DPD already has keeps its dispatch. */
  if ((await shipmentsOf(svc, row)).some(isPickedUp)) {
    throw new ActionError(409, "already_shipped", "DPD already has a parcel of this dispatch: the dispatch cannot be canceled.")
  }
  const moved = await store.transitionDispatch(row.id, [state], { state: "canceled", error: null, error_code: null, updated_by: input.actor })
  if (!moved) throw busyError()
  const released = await store.releaseShipments(row.id, null)
  const cleared = await clearFulfillmentMarkers(scope, fulfillmentIdsOf(released))
  const markersFailed = cleared.failed.length > 0 ? cleared.failed.length : undefined
  const message = state === "printed" ? "Dispatch canceled: the printed protocol is no longer valid; do not give it to the courier." : "Dispatch canceled."
  await dispatchEvent(scope, row, input, "dispatch_canceled", message, { previous: state, shipments: released.length, markersFailed })
  for (const s of released) await dispatchEvent(scope, row, input, "dispatch_canceled", "Released: the dispatch was canceled.", { previous: state }, s)
  return dispatchView(scope, id)
}

/* ------------------------------------------------------------------ */
/* Withdraw (6.9)                                                      */
/* ------------------------------------------------------------------ */

type WithdrawResult = { shipment: ShipmentRow; dispatch: DispatchRow; withdrawn: boolean; warnings: ProblemDto[] }

/** The rest of a dispatch after a withdraw: params, hash and problems (6.9 point 5); the demo sender warning stays. */
function restOf(row: DispatchRow, rest: readonly ShipmentRow[], sender: NonNullable<ReturnType<typeof dispatchSenderOf>>, o: ReturnType<DpdModuleService["getOptions"]>) {
  const boxes = rest.flatMap((x) => shipmentBoxesOf(x, o.defaultBox, o.demo) ?? [])
  const { params, warnings } = packagesParamsOf(boxes, o.defaultBox)
  const hash = dispatchPlanHash({
    shipments: [...rest].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((x) => ({ id: x.id, waybills: waybillsOf(x.waybills) })),
    sender: sender.address,
    params,
  })
  const kept = problemsOf(row.problems).filter((p) => p.code === "sample_sender")
  const list = [...orderProblemsOf(sender, params), ...warnings, ...kept]
  return { params, hash, problems: list.length > 0 ? list : null, warnings }
}

/**
 * DS12: pending and printed locally (writer shipment, protocol_stale for
 * printed); ordered: PATCH, or DELETE for the last shipment (writer pickup).
 * The last shipment out ends the dispatch canceled (O9). An orphan is
 * released locally without DPD (P13, E19).
 */
export async function withdrawShipment(scope: Scope, shipmentId: string, input: DispatchInput): Promise<WithdrawResult> {
  const svc = dpdService(scope)
  const o = svc.getOptions()
  const store = storeFor(scope)
  const at = input.now ?? new Date()
  const s = await mustFind(scope, shipmentId)
  if (!s.dispatch_id) throw new ActionError(409, "not_candidate", "The shipment is not in a dispatch.")
  const row = await getDispatchOfMode(svc, s.dispatch_id)
  if (!row) throw new ActionError(409, "not_candidate", "The shipment is not in a dispatch of the current mode.")
  const state = dispatchStateOf(row.state)
  if (CLAIMED.includes(state)) throw busyError()
  if (state === "unknown") throw new ActionError(409, "wrong_state", "Resolve the courier order of this dispatch first: mark it as ordered or not ordered.")

  /* A dispatch canceled before this shipment was released: release it alone. */
  if (state === "canceled") {
    await requireArmed(scope, "shipment")
    await store.releaseShipments(row.id, [s.id])
    const cleared = await clearFulfillmentMarkers(scope, fulfillmentIdsOf([s]))
    const markersFailed = cleared.failed.length > 0 ? cleared.failed.length : undefined
    await dispatchEvent(scope, row, input, "shipment_withdrawn", "Released from a canceled dispatch.", { previous: state, outcome: "local", markersFailed }, s)
    return { shipment: await currentShipment(svc, s), dispatch: row, withdrawn: true, warnings: [] }
  }

  /* P13: an orphan of an interrupted withdraw. */
  if (!dispatchShipmentIdsOf(row.shipment_ids).includes(s.id)) {
    await requireArmed(scope, state === "ordered" ? "pickup" : "shipment")
    await releaseOrphans(scope, row, [s], input)
    return { shipment: await currentShipment(svc, s), dispatch: await currentDispatch(svc, row), withdrawn: true, warnings: [] }
  }

  /* DS13: after the pickup nothing is withdrawn; the two repairs above only finish a decision already stored (O19). */
  if (isPickedUp(s)) throw new ActionError(409, "already_shipped", ALREADY_SHIPPED)
  if (state === "ordered" && !hasUsableCheckSum(row)) {
    throw new ActionError(409, "no_check_sum", "This courier order has no checkSum: call the courier off at DPD, resolve the order as not ordered, then withdraw the shipment.")
  }
  await requireArmed(scope, state === "ordered" ? "pickup" : "shipment")
  const client = state === "ordered" ? requireClient(scope, svc) : null
  const sender = requireSender(row)
  const shipments = await releaseOrphans(scope, row, await shipmentsOf(svc, row), input)
  const rest = shipments.filter((x) => x.id !== s.id)
  const restIds = rest.map((x) => x.id)
  const next = rest.length > 0 ? restOf(row, rest, sender, o) : null

  const released = async (ids: readonly string[] | null): Promise<{ markersFailed: number | undefined }> => {
    await store.releaseShipments(row.id, ids)
    const cleared = await clearFulfillmentMarkers(scope, fulfillmentIdsOf([s]))
    if (cleared.failed.length > 0) warn(svc, row.id, `the handover marker of the withdrawn shipment ${s.id} was not cleared.`)
    return { markersFailed: cleared.failed.length > 0 ? cleared.failed.length : undefined }
  }
  const result = async (withdrawn: boolean, warnings: ProblemDto[]): Promise<WithdrawResult> => ({
    shipment: await currentShipment(svc, s),
    dispatch: await currentDispatch(svc, row),
    withdrawn,
    warnings,
  })

  /* 6. pending and printed: locally; the plan_hash stops a second concurrent withdraw (E1). */
  if (state === "pending" || state === "printed") {
    const moved = next
      ? await store.transitionDispatch(row.id, [state], { shipment_ids: restIds, params: next.params, problems: next.problems, plan_hash: next.hash, updated_by: input.actor }, { plan_hash: row.plan_hash })
      : await store.transitionDispatch(row.id, [state], { state: "canceled", error: null, error_code: null, updated_by: input.actor }, { plan_hash: row.plan_hash })
    if (!moved) throw await lostTransition(svc, row)
    const { markersFailed } = await released(next ? [s.id] : null)
    await dispatchEvent(scope, row, input, "shipment_withdrawn", "Withdrawn from the dispatch.", { previous: state, outcome: "local", markersFailed }, s)
    await dispatchEvent(scope, row, input, "shipment_withdrawn", "A shipment was withdrawn from the dispatch.", { previous: state, outcome: "local", shipments: rest.length })
    if (!next) await dispatchEvent(scope, row, input, "dispatch_canceled", "Dispatch canceled: its last shipment was withdrawn.", { previous: state, shipments: 0 })
    const warnings: ProblemDto[] = next ? [...(state === "printed" ? [{ code: "protocol_stale" }] : []), ...next.warnings] : []
    return result(true, warnings)
  }

  /* 7 and 8. ordered: DELETE for the last shipment, PATCH otherwise. */
  const today = warsawDate(at)
  const payerFid = requirePayerFid(svc)
  const live = client ?? requireClient(scope, svc)
  const orderNumber = row.order_number ?? ""
  const checkSum = row.check_sum ?? ""
  const op: "update" | "delete" = next ? "update" : "delete"
  let call: () => Promise<PickupCallChangeOutcome>
  let update: ReturnType<typeof pickupCallUpdateRequest> | null = null
  if (next) {
    if (!row.pickup_date || !row.pickup_time_from || !row.pickup_time_to) throw new ActionError(409, "wrong_state", "The stored pickup window of this courier order cannot be read.")
    const window: CourierWindow = { pickupDate: row.pickup_date, pickupTimeFrom: row.pickup_time_from, pickupTimeTo: row.pickup_time_to }
    update = pickupCallUpdateRequest({ orderNumber, checkSum, window, sender, params: next.params })
    const refusal = validateCourierCall(update, { today, payerFid, op: "update" })
    if (refusal) throw new ActionError(409, "wrong_state", `The courier order cannot be changed any more: ${refusal.message}`)
    const body = update
    call = () => live.pickupCallUpdate(body)
  } else {
    const query = { orderNumber, checkSum }
    if (validateCourierCall(query, { today, payerFid, op: "delete" })) throw noCheckSum()
    call = () => live.pickupCallDelete(query)
  }

  const { token, leaseUntil } = claimToken(at, COURIER_LEASE_MS)
  const claimed = await store.claimDispatch(row.id, ["ordered"], {
    token,
    leaseUntil,
    to: "updating",
    patch: next ? { error: UPDATE_LEASE_ERROR, error_code: "update_unclear", updated_by: input.actor } : { error: CANCEL_LEASE_ERROR, error_code: "cancel_unclear", updated_by: input.actor },
    expect: { error_code: row.error_code },
  })
  if (!claimed) throw await lostTransition(svc, row)
  /* P6 against the row read before the claim (E17): every shipment with this one, the stored params, the order (E5). */
  if (
    !sameList(dispatchShipmentIdsOf(claimed.shipment_ids), shipments.map((x) => x.id)) ||
    canonicalJson(claimed.params) !== canonicalJson(row.params) ||
    !sameOrder(claimed, row)
  ) {
    await store.finishDispatch(row.id, token, { state: "ordered", ...keepAttention(row, null, null) }, { unsent: {} })
    throw changedError()
  }

  const outcome = await callDpd(svc, call)
  if (nothingSent(outcome)) {
    const finished = await store.finishDispatch(row.id, token, { state: "ordered", ...keepAttention(row, "rate_limited", masked(svc, outcome.kind === "ok" ? "" : outcome.message)) }, { unsent: {} })
    if (finished) {
      await dispatchEvent(scope, row, input, op === "update" ? "courier_update_refused" : "courier_cancel_refused", "Too many DPD calls right now; nothing was sent. Withdraw the shipment again in a moment.", {
        code: "rate_limited",
        sent: false,
      })
    }
    return result(false, [])
  }
  if (outcome.kind === "ok") {
    const answer = outcome
    if (next) {
      const saved = await finishConfirmed(store, row.id, token, {
        state: "ordered",
        shipment_ids: restIds,
        params: next.params,
        problems: next.problems,
        plan_hash: next.hash,
        order_number: answer.orderNumber ?? row.order_number,
        check_sum: answer.checkSum ?? row.check_sum,
        error: null,
        error_code: null,
      })
      if (saved.failure) {
        await recordUnsavedChange(scope, row, input, "update", answer.orderNumber ?? row.order_number, answer.traceId, saved.failure.error)
        throw saved.failure.error
      }
      if (!saved.finished) return result(false, [])
      /* A failure between these writes leaves an orphan; P13 releases it at the next step (E19). */
      const { markersFailed } = await released([s.id])
      await dispatchEvent(scope, row, input, "shipment_withdrawn", "Withdrawn from the dispatch; the courier order was changed.", { previous: state, outcome: "patched", markersFailed, traceId: answer.traceId }, s)
      await dispatchEvent(scope, row, input, "shipment_withdrawn", "A shipment was withdrawn; the courier order was changed.", { previous: state, outcome: "patched", shipments: rest.length, traceId: answer.traceId, sent: true })
      return result(true, [{ code: "protocol_stale" }, ...next.warnings])
    }
    const saved = await finishConfirmed(store, row.id, token, { state: "canceled", ...CLEARED_ORDER, error: null, error_code: null })
    if (saved.failure) {
      await recordUnsavedChange(scope, row, input, "delete", row.order_number, answer.traceId, saved.failure.error)
      throw saved.failure.error
    }
    if (!saved.finished) return result(false, [])
    const { markersFailed } = await released(null)
    await dispatchEvent(scope, row, input, "courier_canceled", "The courier was canceled: the last shipment was withdrawn.", { orderNumber: row.order_number, traceId: answer.traceId, sent: true })
    await dispatchEvent(scope, row, input, "shipment_withdrawn", "Withdrawn from the dispatch; the courier was canceled.", { previous: state, outcome: "deleted", markersFailed }, s)
    await dispatchEvent(scope, row, input, "dispatch_canceled", "Dispatch canceled: its last shipment was withdrawn.", { previous: state, shipments: 0 })
    return result(true, [])
  }
  await finishChangeFailure(scope, row, token, input, outcome, op, claimed)
  return result(false, [])
}

/* ------------------------------------------------------------------ */
/* Do not send (6.12)                                                  */
/* ------------------------------------------------------------------ */

/** DS15: created | labeled, outbound, dispatch_id null, handed_over_at null, not picked up (DS13) -> excluded (expect dispatch_id null and the stage, tracking and shipped mark read, E20, E23, R14). Writer shipment. */
export async function excludeShipment(scope: Scope, shipmentId: string, input: DispatchInput): Promise<ShipmentRow> {
  const row = await mustFind(scope, shipmentId)
  await requireArmed(scope, "shipment")
  if (isPickedUp(row)) throw new ActionError(409, "already_shipped", ALREADY_SHIPPED)
  if (row.kind !== "outbound" || (row.state !== "created" && row.state !== "labeled") || row.dispatch_id !== null || Boolean(row.handed_over_at)) {
    throw new ActionError(409, "not_candidate", "Only a created or labeled outbound shipment outside a dispatch, not handed over, can be marked do not send.")
  }
  /*
   * What isPickedUp read: a status pass that wrote the row in between wins
   * (R14), also one that added possession under the same stage (a problem
   * box keeps the row at problem, rule 2).
   */
  const moved = await storeFor(scope).transition(
    row.id,
    [row.state],
    { state: "excluded" },
    { dispatch_id: null, stage: row.stage ?? null, tracking: row.tracking ?? null, shipped_marked_at: row.shipped_marked_at ?? null },
  )
  if (!moved) throw new ActionError(409, "not_candidate", "The shipment changed a moment ago; read it again.")
  const cod = row.cod_minor !== null && row.cod_minor !== undefined && Number(row.cod_minor) > 0
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source: sourceOf(input.actor),
    actor: input.actor,
    message: `Marked do not send. DPD cannot cancel a shipment through the API${cod ? "; the cash on delivery will not be collected" : ""}.`,
    data: { action: "shipment_excluded", previous: row.state },
    mode: modeOf(row.mode),
  })
  return moved
}

/** excluded -> labeled (a stored label) or created. Writer shipment. */
export async function restoreShipment(scope: Scope, shipmentId: string, input: DispatchInput): Promise<ShipmentRow> {
  const row = await mustFind(scope, shipmentId)
  await requireArmed(scope, "shipment")
  if (row.state !== "excluded") throw new ActionError(409, "not_candidate", "Only a shipment marked do not send can be restored.")
  const to = (await latestLabel(scope, row.id)) ? "labeled" : "created"
  const moved = await storeFor(scope).transition(row.id, ["excluded"], { state: to }, { dispatch_id: null })
  if (!moved) throw new ActionError(409, "not_candidate", "The shipment changed a moment ago; read it again.")
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source: sourceOf(input.actor),
    actor: input.actor,
    message: to === "labeled" ? "Restored: the shipment can go to a dispatch again." : "Restored: get the label first.",
    data: { action: "shipment_restored", outcome: to },
    mode: modeOf(row.mode),
  })
  return moved
}

/* ------------------------------------------------------------------ */
/* The pass (6.13)                                                     */
/* ------------------------------------------------------------------ */

const SYSTEM: DispatchInput = { actor: null }

/**
 * DS8, E18: an expired first print is taken by the pass with its own token,
 * its markers cleared while the pass holds it (outside demo, O18), then it
 * goes back to pending; the other expired claims go where their state says.
 * Never prints, orders, changes or resolves anything. Returns the count.
 */
export async function expireDispatches(scope: Scope, mode: DpdMode, now: Date): Promise<number> {
  const svc = dpdService(scope)
  const store = storeFor(scope)
  const { token, leaseUntil } = claimToken(now, PROTOCOL_LEASE_MS)
  const taken = await store.claimExpiredFirstPrints(mode, now, { token, leaseUntil })
  const handedBack: DispatchRow[] = []
  for (const r of taken) {
    if (!svc.isDemo()) {
      try {
        const shipments = await listShipments(svc, { dispatch_id: r.id, mode }, { take: DISPATCH_MAX_SHIPMENTS + 1 })
        await clearFulfillmentMarkers(scope, fulfillmentIdsOf(shipments))
      } catch (err) {
        warn(svc, r.id, `the markers of an expired first print were not cleared: ${errorText(svc, err)}`)
      }
    }
    const finished = await store.finishDispatch(r.id, token, { state: "pending", error: r.error, error_code: "protocol_unclear" })
    if (finished) handedBack.push(finished)
  }
  const rows = await store.expireDispatchLeases(mode, now)
  for (const r of [...handedBack, ...rows]) {
    const state = dispatchStateOf(r.state)
    const message =
      state === "unknown"
        ? ORDER_LEASE_ERROR
        : state === "ordered"
          ? (r.error ?? UPDATE_LEASE_ERROR)
          : PROTOCOL_LEASE_ERROR
    await dispatchEvent(scope, r, SYSTEM, "dispatch_lease_expired", message, { code: r.error_code, outcome: state })
    if (state === "unknown" || isAttentionRow(r)) warn(svc, r.id, `the lease ran out (${r.error_code ?? "no code"}); a person checks the courier order at DPD.`)
  }
  return handedBack.length + rows.length
}
