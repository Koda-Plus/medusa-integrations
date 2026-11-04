import {
  COD_CURRENCIES,
  COURIER_CHECKSUM_MAX,
  COURIER_CHECKSUM_MIN,
  DISPATCH_CLAIMED_STATES,
  DISPATCH_STATES,
  LABEL_PAGES,
  MODES,
  OPTION_SPECS,
  SHIPMENT_STAGES,
  SHIPMENT_STATES,
  UNKNOWN_SETTLE_MS,
  type CodCurrency,
  type DispatchState,
  type DpdMode,
  type LabelPage,
  type ShipmentStage,
  type ShipmentState,
} from "./constants"
import {
  ATTENTION_GROUPS,
  DISPATCH_ATTENTION_CODES,
  SHIPMENT_GROUPS,
  dispatchNeedsAttention,
  groupOf,
  type BoxDto,
  type CountsDto,
  type DispatchActions,
  type DispatchDto,
  type DispatchParamsDto,
  type DispatchPlanDto,
  type DispatchProtocolDto,
  type DocumentDto,
  type EventDto,
  type PlanAddressDto,
  type PlanDto,
  type PlanPointDto,
  type PlanPudoReceiverDto,
  type PointsSourceKind,
  type ProblemDto,
  type ShipmentActions,
  type ShipmentDto,
  type ShipmentGroup,
  type TrackingDto,
  type WriterDto,
} from "./contract"
import { readStoredBoxes } from "./boxes"
import { DISPATCH_WARNING_CODES, dispatchSenderOf, orderProblemsOf, packagesParamsFrom, type DispatchPlan } from "./dispatch"
import type { DpdAddress, DpdPackagesParams, DpdPudoReceiver } from "./dpdservices"
import type { DpdShipmentEvent } from "./events"
import { formatMinor } from "./money"
import type { Plan, PlanPoint } from "./plan"
import { isPickedUp, returnDone, rowStatus, trackingOf, type TrackingEntry } from "./tracking"
import type { WriterState } from "./writers"

/**
 * Rows as the generated service (and the atomic store) returns them, and how
 * the admin sees them. Dates go out as ISO strings, money as "199.99". No
 * row holds the receiver's name, phone, e-mail or street, so no answer built
 * from a row does; only the plan (toPlanDto) shows them, read live from the
 * order and never stored.
 */

type When = Date | string | null | undefined

export type ShipmentRow = {
  id: string
  order_id: string | null
  display_id: number | null
  fulfillment_id: string | null
  return_id: string | null
  kind: string
  mode: string
  option_id: string
  service: string | null
  pudo_id: string | null
  country_code: string | null
  session_type: string | null
  cod_minor: number | null
  currency: string | null
  reference: string | null
  references: unknown
  boxes: unknown
  waybills: unknown
  session_id: string | null
  state: string
  status: string | null
  stage: string | null
  plan_hash: string | null
  problems: unknown
  dispatch_id: string | null
  handed_over_at: When
  claim_token: string | null
  lease_until: When
  shipped_marked_at: When
  delivered_marked_at: When
  last_checked_at: When
  error: string | null
  error_code: string | null
  attempts: number
  created_at?: When
  updated_at?: When
  deleted_at?: When
  /* Stage 5 (optional: rows built by older code and test literals stay valid). */
  tracking?: unknown
  status_at?: When
  status_writer_error?: string | null
}

export type EventRow = {
  id: string
  shipment_id: string | null
  dispatch_id: string | null
  order_id: string | null
  waybill: string | null
  kind: string
  status: string | null
  previous_status: string | null
  source: string | null
  message: string | null
  data: unknown
  actor: string | null
  dedupe_key: string | null
  object_id: string | null
  mode: string
  occurred_at: When
  created_at?: When
}

export type SettingRow = {
  id: string
  key: string
  value: unknown
  updated_by: string | null
  updated_at?: When
}

/** A row of dpd_document. `data` is the base64 DPD sent: never logged, never masked, never in an answer but the PDF itself. */
export type DocumentRow = {
  id: string
  shipment_id: string | null
  dispatch_id: string | null
  type: string
  format: string
  page: string | null
  document_id: string | null
  data: string
  mode: string
  created_by: string | null
  created_at?: When
}

/** A row of dpd_dispatch: one handover to the courier (DS1, DS2). No receiver data; the sender snapshot is the shop's own. */
export type DispatchRow = {
  id: string
  mode: string
  state: string
  location_id: string | null
  sender: unknown
  params: unknown
  problems: unknown
  plan_hash: string | null
  shipment_ids: unknown
  protocols: unknown
  protocol_at: When
  pickup_date: string | null
  pickup_time_from: string | null
  pickup_time_to: string | null
  order_type: string | null
  order_number: string | null
  /** Never logged, never in a DTO, an event or an answer. */
  check_sum: string | null
  ordered_at: When
  claim_token: string | null
  lease_until: When
  error: string | null
  error_code: string | null
  attempts: number
  created_by: string | null
  updated_by: string | null
  created_at?: When
  updated_at?: When
  deleted_at?: When
}

/** One entry of dpd_dispatch.protocols. */
export type StoredProtocol = { docId: string; documentId: string | null; at: string; shipmentIds: string[] }

export function iso(v: When): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** A stored state; an unknown value reads as pending (nothing was sent, so nothing is claimed). */
export function shipmentStateOf(v: unknown): ShipmentState {
  return (SHIPMENT_STATES as readonly unknown[]).includes(v) ? (v as ShipmentState) : "pending"
}

/** A stored stage, or null before DPD reports anything (an unknown value too). */
export function shipmentStageOf(v: unknown): ShipmentStage | null {
  return (SHIPMENT_STAGES as readonly unknown[]).includes(v) ? (v as ShipmentStage) : null
}

export function modeOf(v: unknown): DpdMode {
  return (MODES as readonly unknown[]).includes(v) ? (v as DpdMode) : "sandbox"
}

/** A stored label page, or null. */
export function labelPageOrNull(v: unknown): LabelPage | null {
  return (LABEL_PAGES as readonly unknown[]).includes(v) ? (v as LabelPage) : null
}

/** The waybills of a row (a JSON list of strings), in box order. */
export function waybillsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((w): w is string => typeof w === "string" && w.length > 0) : []
}

/**
 * The problems of a row (a JSON list of { code, field?, detail?, source? });
 * anything else is dropped. `source` survives only as "dpd" (what DPD said at
 * the last attempt, kept on a failed row next to the plan problems).
 */
export function problemsOf(v: unknown): ProblemDto[] {
  if (!Array.isArray(v)) return []
  const out: ProblemDto[] = []
  for (const p of v) {
    if (!p || typeof p !== "object") continue
    const r = p as Record<string, unknown>
    if (typeof r.code !== "string" || !r.code) continue
    out.push({
      code: r.code,
      ...(typeof r.field === "string" ? { field: r.field } : {}),
      ...(typeof r.detail === "string" ? { detail: r.detail } : {}),
      ...(r.source === "dpd" ? { source: "dpd" as const } : {}),
    })
  }
  return out
}

/** The Panel list of a row: the same rule as the admin (groupOf) and the SQL of the store (GROUP_SQL); `now` for returnDone (E61). */
export function rowGroup(row: Pick<ShipmentRow, "kind" | "state" | "stage" | "handed_over_at" | "created_at" | "waybills"> & { tracking?: unknown }, now: Date = new Date()): ShipmentGroup {
  const stage = shipmentStageOf(row.stage)
  return groupOf({
    kind: row.kind === "return" ? "return" : "outbound",
    state: shipmentStateOf(row.state),
    stage,
    handedOver: Boolean(row.handed_over_at),
    returnDone: returnDone({ ...row, stage }, now),
  })
}

/**
 * What a person may do with a row now, from its state alone (the admin also
 * checks that the shipment writer is armed before a write to DPD). A lookup
 * only for an unclear row without waybills (one with waybills was found
 * already, a second lookup would advise it again); accepting only with
 * waybills (without them there is nothing to accept); the stored label also
 * for a row a person still has to decide about. Exclude, withdraw and
 * dispatch stop once DPD has the parcel (isPickedUp, DS13, E54). refreshStatus for an outbound
 * created or labeled row with waybills, not canceled and not a sample demo
 * row (the route refuses not_configured when the source is off);
 * retryStatusWriter for a row with status_writer_error.
 */
export function shipmentActions(
  row: Pick<ShipmentRow, "state" | "kind" | "waybills" | "dispatch_id" | "handed_over_at" | "session_type" | "stage" | "shipped_marked_at" | "mode" | "fulfillment_id"> & {
    status_writer_error?: string | null
    tracking?: unknown
  },
): ShipmentActions {
  const state = shipmentStateOf(row.state)
  const outbound = row.kind !== "return"
  const open = state === "pending" || state === "failed"
  const hasWaybills = waybillsOf(row.waybills).length > 0
  const unclear = state === "unknown" || state === "abandoned_unknown"
  const inDispatch = Boolean(row.dispatch_id)
  const handedOver = Boolean(row.handed_over_at)
  const domestic = !row.session_type || row.session_type === "DOMESTIC"
  const pickedUp = isPickedUp(row)
  const seed = row.mode === "demo" && !row.fulfillment_id
  return {
    plan: open && outbound,
    create: open && outbound,
    boxes: open,
    fetchLabel: state === "created",
    label: state === "labeled" || ((state === "ambiguous" || state === "abandoned_unknown") && hasWaybills),
    lookup: unclear && !hasWaybills,
    accept: state === "ambiguous" && hasWaybills,
    skip: open || state === "ambiguous",
    exclude: (state === "created" || state === "labeled") && outbound && !inDispatch && !handedOver && !pickedUp,
    restore: state === "excluded",
    withdraw: inDispatch && !pickedUp,
    dispatch: state === "labeled" && outbound && domestic && !inDispatch && !handedOver && !pickedUp,
    refreshStatus: (state === "created" || state === "labeled") && outbound && hasWaybills && !seed && row.stage !== "canceled",
    retryStatusWriter: Boolean(row.status_writer_error),
  }
}

/** The stored boxes of a row (dpd_shipment.boxes) for the admin; null when there are none. */
export function toBoxDtos(value: unknown): BoxDto[] | null {
  const stored = readStoredBoxes(value)
  if (!stored) return null
  return stored.items.map((b) => ({
    weightKg: b.weightKg,
    lengthCm: b.lengthCm,
    widthCm: b.widthCm,
    heightCm: b.heightCm,
    reference: b.reference,
    waybill: b.waybill,
  }))
}

/** The time a lookup of an unclear row may run: UNKNOWN_SETTLE_MS after it last changed. */
export function lookupAfterOf(row: Pick<ShipmentRow, "state" | "updated_at">): string | null {
  if (row.state !== "unknown" && row.state !== "abandoned_unknown") return null
  const at = iso(row.updated_at)
  return at ? new Date(new Date(at).getTime() + UNKNOWN_SETTLE_MS).toISOString() : null
}

export function toShipmentDto(row: ShipmentRow): ShipmentDto {
  const spec = OPTION_SPECS.find((s) => s.id === row.option_id) ?? null
  const mode = modeOf(row.mode)
  const minor = row.cod_minor === null || row.cod_minor === undefined ? null : Number(row.cod_minor)
  const attempts = Number(row.attempts ?? 0)
  const tracking = trackingOf(row)
  return {
    id: row.id,
    orderId: row.order_id ?? null,
    displayId: typeof row.display_id === "number" ? row.display_id : null,
    fulfillmentId: row.fulfillment_id ?? null,
    returnId: row.return_id ?? null,
    kind: row.kind === "return" ? "return" : "outbound",
    optionId: row.option_id,
    optionKind: spec?.kind ?? null,
    cod: spec?.cod ?? false,
    codAmount: minor !== null && Number.isFinite(minor) ? formatMinor(minor) : null,
    currency: row.currency ?? null,
    pudoId: row.pudo_id ?? null,
    country: row.country_code ?? null,
    state: shipmentStateOf(row.state),
    stage: shipmentStageOf(row.stage),
    status: row.status ?? null,
    group: rowGroup(row),
    waybills: waybillsOf(row.waybills),
    problems: problemsOf(row.problems),
    error: row.error ?? null,
    errorCode: row.error_code ?? null,
    handedOverAt: iso(row.handed_over_at),
    dispatchId: row.dispatch_id ?? null,
    createdAt: iso(row.created_at),
    mode,
    demo: mode === "demo",
    reference: row.reference ?? null,
    sessionId: row.session_id ?? null,
    attempts: Number.isFinite(attempts) ? attempts : 0,
    boxes: toBoxDtos(row.boxes),
    updatedAt: iso(row.updated_at),
    lookupAfter: lookupAfterOf(row),
    actions: shipmentActions(row),
    tracking: tracking.map(toTrackingDto),
    statusAt: iso(row.status_at),
    statusDescription: rowStatus(tracking).description,
    lastCheckedAt: iso(row.last_checked_at),
    shippedMarkedAt: iso(row.shipped_marked_at),
    deliveredMarkedAt: iso(row.delivered_marked_at),
    statusWriterError: row.status_writer_error ?? null,
  }
}

/** One waybill for the admin: the fields of TrackingDto, copied one by one so nothing else of the entry leaves. */
function toTrackingDto(e: TrackingEntry): TrackingDto {
  return {
    waybill: e.waybill,
    box: e.box,
    role: e.role,
    stage: e.stage,
    code: e.code,
    at: e.at,
    lastCode: e.lastCode,
    lastAt: e.lastAt,
    description: e.description,
    possession: e.possession,
    supersededBy: e.supersededBy,
    supersededAt: e.supersededAt,
    from: e.from,
    checkedAt: e.checkedAt,
    done: e.done,
  }
}

/** The payload of every dpd.shipment.* event of a row: waybillsOf, cod from cod_minor (formatMinor) and currency, stage ?? "preparing", demo = mode === "demo". */
export function toShipmentEvent(
  row: ShipmentRow,
  change: { previousStatus: string | null; previousStage: ShipmentStage | null; eventId: string | null },
): DpdShipmentEvent {
  const minor = row.cod_minor === null || row.cod_minor === undefined ? null : Number(row.cod_minor)
  const currency = (COD_CURRENCIES as readonly unknown[]).includes(row.currency) ? (row.currency as CodCurrency) : null
  const mode = modeOf(row.mode)
  return {
    id: row.id,
    order_id: row.order_id ?? null,
    fulfillment_id: row.fulfillment_id ?? null,
    return_id: row.return_id ?? null,
    kind: row.kind === "return" ? "return" : "outbound",
    option_id: row.option_id,
    waybills: waybillsOf(row.waybills),
    status: row.status ?? null,
    previous_status: change.previousStatus,
    stage: shipmentStageOf(row.stage) ?? "preparing",
    pudo_id: row.pudo_id ?? null,
    country_code: row.country_code ?? null,
    cod: minor !== null && Number.isFinite(minor) && currency ? { amount: formatMinor(minor), currency } : null,
    mode,
    demo: mode === "demo",
    previous_stage: change.previousStage,
    event_id: change.eventId,
  }
}

function addressDto(a: DpdAddress | null): PlanAddressDto | null {
  if (!a) return null
  return {
    company: a.company ?? null,
    name: a.name ?? null,
    address: a.address,
    city: a.city,
    postalCode: a.postalCode,
    countryCode: a.countryCode,
    phone: a.phone ?? null,
    email: a.email ?? null,
  }
}

/** The point of a Pickup plan for the admin: how it was checked now, the point only when it was found. */
function pointDto(p: PlanPoint | null, source: PointsSourceKind): PlanPointDto | null {
  if (p === null) return null
  return {
    pudoId: p.pudoId,
    check: p.status,
    point: p.status === "ok" ? p.point : null,
    reason: p.status === "unchecked" ? p.reason : null,
    source,
  }
}

function pudoReceiverDto(r: DpdPudoReceiver | null): PlanPudoReceiverDto | null {
  if (!r) return null
  return { company: r.company ?? null, name: r.name, countryCode: r.countryCode, phone: r.phone ?? null, email: r.email ?? null }
}

/**
 * The plan for the admin. It carries the receiver read live from the order:
 * answer it with no-store, never store it. `source` is the kind of the points
 * source the Pickup point was read from (pointsFor(scope).kind).
 */
export function toPlanDto(plan: Plan, source: PointsSourceKind): PlanDto {
  const boxes: BoxDto[] = plan.boxes.map((b, i) => ({
    weightKg: b.weightKg,
    lengthCm: b.lengthCm,
    widthCm: b.widthCm,
    heightCm: b.heightCm,
    reference: plan.parcelReferences[i] ?? null,
    waybill: null,
  }))
  const weight = boxes.reduce((sum, b) => sum + (Number.isFinite(b.weightKg) ? b.weightKg : 0), 0)
  return {
    ok: plan.ok,
    optionId: plan.optionId,
    kind: plan.kind,
    cod: plan.cod,
    sessionType: plan.sessionType,
    country: plan.country,
    receiver: addressDto(plan.receiver),
    sender: addressDto(plan.sender),
    senderLocationId: plan.senderLocationId,
    boxes,
    boxesSource: plan.boxesSource,
    weightKg: Math.round(weight * 100) / 100,
    codAmount: plan.codDue ? { amount: plan.codDue.amount, currency: plan.codDue.currency } : null,
    reference: plan.reference,
    problems: plan.problems,
    warnings: plan.warnings,
    request: plan.request,
    hash: plan.hash,
    point: pointDto(plan.point, source),
    pudoReceiver: pudoReceiverDto(plan.pudoReceiver),
  }
}

const DOCUMENT_TYPES_OUT: ReadonlyArray<DocumentDto["type"]> = ["label", "return_label", "protocol"]

/** A stored document for the admin; never carries `data`. `names` turns admin user ids into e-mails. */
export function toDocumentDto(row: Omit<DocumentRow, "data">, names: Record<string, string> = {}): DocumentDto {
  const type = DOCUMENT_TYPES_OUT.find((t) => t === row.type) ?? "label"
  return {
    id: row.id,
    type,
    format: "PDF",
    page: labelPageOrNull(row.page),
    createdAt: iso(row.created_at),
    createdBy: row.created_by ? (names[row.created_by] ?? row.created_by) : null,
  }
}

/** A history row; `names` turns admin user ids into e-mails. */
export function toEventDto(row: EventRow, names: Record<string, string> = {}): EventDto {
  return {
    id: row.id,
    shipmentId: row.shipment_id ?? null,
    orderId: row.order_id ?? null,
    kind: row.kind,
    status: row.status ?? null,
    previousStatus: row.previous_status ?? null,
    source: row.source ?? null,
    message: row.message ?? null,
    actor: row.actor ? (names[row.actor] ?? row.actor) : null,
    occurredAt: iso(row.occurred_at) ?? new Date(0).toISOString(),
    demo: row.mode === "demo",
    dispatchId: row.dispatch_id ?? null,
    action: eventActionOf(row.data),
    waybill: row.waybill ?? null,
  }
}

/** data.action of a history row when it is a string (the dispatch rows name what happened there). */
function eventActionOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null
  const action = (data as { action?: unknown }).action
  return typeof action === "string" ? action : null
}

export function toWriterDto(state: WriterState, names: Record<string, string> = {}): WriterDto {
  return {
    key: state.key,
    allowed: state.allowed,
    on: state.on,
    armed: state.armed,
    updatedBy: state.updatedBy ? (names[state.updatedBy] ?? state.updatedBy) : null,
    updatedAt: state.updatedAt,
  }
}

/** A count of the store as a whole number, 0 for anything else. */
function countOf(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * The counts of the Panel from the grouped counts of the store: every group,
 * all, the dispatches, and the rows asking a person to act (the attention
 * groups plus the dispatches that need a person, DS18, plus the rows whose
 * status write to Medusa failed, O44).
 */
export function countsOf(
  grouped: ReadonlyArray<{ group: ShipmentGroup; count: number }>,
  dispatches?: { open: number; attention: number },
  statuses?: { writerErrors: number },
): CountsDto {
  const counts = { all: 0, attention: 0, dispatches: 0, dispatchesAttention: 0, statusesAttention: 0 } as CountsDto
  for (const g of SHIPMENT_GROUPS) counts[g] = 0
  for (const { group, count } of grouped) {
    if (!(SHIPMENT_GROUPS as readonly string[]).includes(group)) continue
    counts[group] += count
    counts.all += count
    if (ATTENTION_GROUPS.includes(group)) counts.attention += count
  }
  counts.dispatches = countOf(dispatches?.open)
  counts.dispatchesAttention = countOf(dispatches?.attention)
  counts.attention += counts.dispatchesAttention
  counts.statusesAttention = countOf(statuses?.writerErrors)
  counts.attention += counts.statusesAttention
  return counts
}

/* ------------------------------------------------------------------ */
/* Stage 4: the handover to the courier                                */
/* ------------------------------------------------------------------ */

/** A stored dispatch state; an unknown value reads as pending (nothing claimed, nothing ordered). */
export function dispatchStateOf(v: unknown): DispatchState {
  return (DISPATCH_STATES as readonly unknown[]).includes(v) ? (v as DispatchState) : "pending"
}

function stringsOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []
}

/** dpd_dispatch.protocols as stored (oldest first); an entry without a docId or a time is dropped. */
export function storedProtocolsOf(v: unknown): StoredProtocol[] {
  if (!Array.isArray(v)) return []
  const out: StoredProtocol[] = []
  for (const p of v) {
    if (!p || typeof p !== "object") continue
    const r = p as Record<string, unknown>
    if (typeof r.docId !== "string" || !r.docId || typeof r.at !== "string" || !r.at) continue
    out.push({ docId: r.docId, documentId: typeof r.documentId === "string" && r.documentId ? r.documentId : null, at: r.at, shipmentIds: stringsOf(r.shipmentIds) })
  }
  return out
}

/** dpd_dispatch.shipment_ids in their stored order (the order of the protocol). */
export function dispatchShipmentIdsOf(v: unknown): string[] {
  return stringsOf(v)
}

/**
 * A checkSum the courier calls can use: an order number and a checkSum of
 * COURIER_CHECKSUM_MIN to COURIER_CHECKSUM_MAX characters. Anything else
 * counts as no checkSum (DPD would refuse the PATCH or DELETE), so resolve
 * stays the way out (O16).
 */
export function hasUsableCheckSum(row: Pick<DispatchRow, "check_sum" | "order_number">): boolean {
  const sum = row.check_sum
  return (
    typeof sum === "string" &&
    sum.length >= COURIER_CHECKSUM_MIN &&
    sum.length <= COURIER_CHECKSUM_MAX &&
    typeof row.order_number === "string" &&
    row.order_number.length > 0
  )
}

/**
 * What a person may do with a dispatch now, from its state alone (the admin
 * also checks the writers). resolve: unknown, ordered with an error code of
 * DISPATCH_ATTENTION_CODES (O13, O17), or ordered without a usable checkSum
 * (O16; such a row is not attention, dispatchNeedsAttention is unchanged).
 * order: printed and canOrder. Once DPD has a parcel of the dispatch
 * (`shipped`, O43) it cannot be canceled, and when DPD has every one no
 * shipment is withdrawn.
 */
export function dispatchActions(
  row: Pick<DispatchRow, "state" | "check_sum" | "order_number" | "protocols" | "error_code">,
  canOrder: boolean,
  /** Some shipment of the dispatch isPickedUp (O43): cancel false; withdraw false when every one is. */
  shipped?: { any: boolean; all: boolean },
): DispatchActions {
  const state = dispatchStateOf(row.state)
  const usable = hasUsableCheckSum(row)
  const attentionCode = typeof row.error_code === "string" && DISPATCH_ATTENTION_CODES.includes(row.error_code)
  const ordered = state === "ordered"
  return {
    print: state === "pending",
    reprint: state === "printed" || ordered,
    protocol: storedProtocolsOf(row.protocols).length > 0,
    order: state === "printed" && canOrder,
    reschedule: ordered && usable,
    cancelCourier: ordered && usable,
    resolve: state === "unknown" || (ordered && (attentionCode || !usable)),
    cancel: (state === "pending" || state === "printed") && !shipped?.any,
    withdraw: (state === "pending" || state === "printed" || (ordered && usable)) && !shipped?.all,
  }
}

/** Step 2 possible by the stored snapshots: the sender and the params readable and orderProblemsOf empty (read fresh, never from the problems column). dispatchActions still requires printed. */
export function dispatchCanOrder(row: Pick<DispatchRow, "sender" | "params">): boolean {
  const sender = dispatchSenderOf(row.sender)
  const params = packagesParamsFrom(row.params)
  return sender !== null && params !== null && orderProblemsOf(sender, params).length === 0
}

function paramsDto(params: DpdPackagesParams | null, dimsKnown: boolean): DispatchParamsDto | null {
  if (!params) return null
  const p = params.parcel
  return { count: p.count, weightKg: p.weight, maxWeightKg: p.maxWeight, maxHeightCm: p.maxHeight, maxWidthCm: p.maxWidth, maxDepthCm: p.maxDepth, dimsKnown }
}

/* Read at call time: lib/dispatch.ts imports tracking.ts, which imports this file, so a top level copy would meet the binding before it is set (E54). */
const isWarningCode = (code: string): boolean => (DISPATCH_WARNING_CODES as readonly string[]).includes(code)

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort()
  const y = [...b].sort()
  return x.every((v, i) => v === y[i])
}

/**
 * A dispatch for the admin; never the checkSum (hasCheckSum only). The
 * caller drops protocol entries whose document is gone. shipmentProblems is
 * given by dispatchResponse only (E4); missing means []. The problems column
 * splits by code: DISPATCH_WARNING_CODES go to warnings, the rest to problems,
 * and params.dimsKnown is false when the column has dims_unknown (E22). A
 * protocol is stale when it does not list exactly shipment_ids. error and
 * errorCode are null while the row is claimed (the claim presets what a lease
 * expiry leaves).
 */
export function toDispatchDto(row: DispatchRow, shipments: readonly ShipmentRow[], input: { canOrder: boolean; simulated: boolean; shipmentProblems?: ProblemDto[] }): DispatchDto {
  const mode = modeOf(row.mode)
  const state = dispatchStateOf(row.state)
  const stored = problemsOf(row.problems)
  const params = packagesParamsFrom(row.params)
  const sender = dispatchSenderOf(row.sender)
  const shipmentIds = dispatchShipmentIdsOf(row.shipment_ids)
  const claimed = (DISPATCH_CLAIMED_STATES as readonly string[]).includes(state)
  const attempts = Number(row.attempts ?? 0)
  const protocols: DispatchProtocolDto[] = storedProtocolsOf(row.protocols)
    .reverse()
    .map((p) => ({ id: p.docId, documentId: p.documentId, createdAt: iso(p.at), shipments: p.shipmentIds.length, stale: !sameIds(p.shipmentIds, shipmentIds) }))
  return {
    id: row.id,
    mode,
    demo: mode === "demo",
    state,
    locationId: row.location_id ?? null,
    sender: addressDto(sender?.address ?? null),
    shipmentIds,
    shipments: shipments.map(toShipmentDto),
    boxes: params?.parcel.count ?? 0,
    weightKg: params?.parcel.weight ?? 0,
    params: paramsDto(params, !stored.some((p) => p.code === "dims_unknown")),
    problems: stored.filter((p) => !isWarningCode(p.code)),
    warnings: stored.filter((p) => isWarningCode(p.code)),
    shipmentProblems: input.shipmentProblems ?? [],
    protocols,
    protocolAt: iso(row.protocol_at),
    pickupDate: row.pickup_date ?? null,
    pickupTimeFrom: row.pickup_time_from ?? null,
    pickupTimeTo: row.pickup_time_to ?? null,
    orderType: row.order_type === "DOMESTIC" ? "DOMESTIC" : null,
    orderNumber: row.order_number ?? null,
    hasCheckSum: hasUsableCheckSum(row),
    orderedAt: iso(row.ordered_at),
    simulated: input.simulated,
    error: claimed ? null : (row.error ?? null),
    errorCode: claimed ? null : (row.error_code ?? null),
    attempts: Number.isFinite(attempts) ? attempts : 0,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    attention: dispatchNeedsAttention({ state, errorCode: row.error_code ?? null }),
    actions: dispatchActions(row, input.canOrder, { any: shipments.some(isPickedUp), all: shipments.length > 0 && shipments.every(isPickedUp) }),
  }
}

/** A dispatch plan for the admin: the sender and the orderer are the shop's own, no receiver data. */
export function toDispatchPlanDto(plan: DispatchPlan): DispatchPlanDto {
  return {
    ok: plan.ok,
    canOrder: plan.canOrder,
    groups: plan.groups.map((g) => ({ key: g.key, locationId: g.locationId, sender: addressDto(g.sender), shipmentIds: [...g.shipmentIds] })),
    locationId: plan.locationId,
    sender: addressDto(plan.sender?.address ?? null),
    orderer: plan.sender ? { name: plan.sender.orderer.name, fullName: plan.sender.orderer.fullName, phone: plan.sender.orderer.phone } : null,
    shipments: plan.shipments.map((s) => ({
      id: s.id,
      orderId: s.orderId,
      displayId: s.displayId,
      reference: s.reference,
      waybills: [...s.waybills],
      boxes: s.boxes.length,
      weightKg: s.weightKg,
      problems: s.problems,
    })),
    params: paramsDto(plan.params, !plan.warnings.some((p) => p.code === "dims_unknown")),
    problems: plan.problems,
    orderProblems: plan.orderProblems,
    warnings: plan.warnings,
    hash: plan.hash,
  }
}
