import { MODES, OPTION_SPECS, SHIPMENT_STAGES, SHIPMENT_STATES, type DpdMode, type ShipmentStage, type ShipmentState } from "./constants"
import { ATTENTION_GROUPS, SHIPMENT_GROUPS, groupOf, type CountsDto, type EventDto, type ProblemDto, type ShipmentDto, type ShipmentGroup, type WriterDto } from "./contract"
import { formatMinor } from "./money"
import type { WriterState } from "./writers"

/**
 * Rows as the generated service (and the atomic store) returns them, and how
 * the admin sees them. Dates go out as ISO strings, money as "199.99". No
 * row holds the receiver's name, phone, e-mail or street, so no answer does.
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

export function toShipmentDto(row: ShipmentRow): ShipmentDto {
  const spec = OPTION_SPECS.find((s) => s.id === row.option_id) ?? null
  const mode = modeOf(row.mode)
  const minor = row.cod_minor === null || row.cod_minor === undefined ? null : Number(row.cod_minor)
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
