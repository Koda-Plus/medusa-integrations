import { LABEL_PAGES, MODES, OPTION_SPECS, SHIPMENT_STAGES, SHIPMENT_STATES, UNKNOWN_SETTLE_MS, type DpdMode, type LabelPage, type ShipmentStage, type ShipmentState } from "./constants"
import {
  ATTENTION_GROUPS,
  SHIPMENT_GROUPS,
  groupOf,
  type BoxDto,
  type CountsDto,
  type DocumentDto,
  type EventDto,
  type PlanAddressDto,
  type PlanDto,
  type ProblemDto,
  type ShipmentActions,
  type ShipmentDto,
  type ShipmentGroup,
  type WriterDto,
} from "./contract"
import { readStoredBoxes } from "./boxes"
import type { DpdAddress } from "./dpdservices"
import { formatMinor } from "./money"
import type { Plan } from "./plan"
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

/** The problems of a row (a JSON list of { code, field?, detail? }); anything else is dropped. */
export function problemsOf(v: unknown): ProblemDto[] {
  if (!Array.isArray(v)) return []
  const out: ProblemDto[] = []
  for (const p of v) {
    if (!p || typeof p !== "object") continue
    const r = p as Record<string, unknown>
    if (typeof r.code !== "string" || !r.code) continue
    out.push({ code: r.code, ...(typeof r.field === "string" ? { field: r.field } : {}), ...(typeof r.detail === "string" ? { detail: r.detail } : {}) })
  }
  return out
}

/** The Panel list of a row: the same rule as the admin (groupOf) and the SQL of the store (GROUP_SQL). */
export function rowGroup(row: Pick<ShipmentRow, "kind" | "state" | "stage" | "handed_over_at">): ShipmentGroup {
  return groupOf({
    kind: row.kind === "return" ? "return" : "outbound",
    state: shipmentStateOf(row.state),
    stage: shipmentStageOf(row.stage),
    handedOver: Boolean(row.handed_over_at),
  })
}

/**
 * What a person may do with a row now, from its state alone (the admin also
 * checks that the shipment writer is armed before a write to DPD). A lookup
 * only for an unclear row without waybills (one with waybills was found
 * already, a second lookup would advise it again); accepting only with
 * waybills (without them there is nothing to accept); the stored label also
 * for a row a person still has to decide about.
 */
export function shipmentActions(row: Pick<ShipmentRow, "state" | "kind" | "waybills">): ShipmentActions {
  const state = shipmentStateOf(row.state)
  const outbound = row.kind !== "return"
  const open = state === "pending" || state === "failed"
  const hasWaybills = waybillsOf(row.waybills).length > 0
  const unclear = state === "unknown" || state === "abandoned_unknown"
  return {
    plan: open && outbound,
    create: open && outbound,
    boxes: open,
    fetchLabel: state === "created",
    label: state === "labeled" || ((state === "ambiguous" || state === "abandoned_unknown") && hasWaybills),
    lookup: unclear && !hasWaybills,
    accept: state === "ambiguous" && hasWaybills,
    skip: open || state === "ambiguous",
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

/** The plan for the admin. It carries the receiver read live from the order: answer it with no-store, never store it. */
export function toPlanDto(plan: Plan): PlanDto {
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
  }
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

/** The counts of the Panel from the grouped counts of the store: every group, all, and the groups asking a person to act. */
export function countsOf(grouped: ReadonlyArray<{ group: ShipmentGroup; count: number }>): CountsDto {
  const counts = { all: 0, attention: 0 } as CountsDto
  for (const g of SHIPMENT_GROUPS) counts[g] = 0
  for (const { group, count } of grouped) {
    if (!(SHIPMENT_GROUPS as readonly string[]).includes(group)) continue
    counts[group] += count
    counts.all += count
    if (ATTENTION_GROUPS.includes(group)) counts.attention += count
  }
  return counts
}
