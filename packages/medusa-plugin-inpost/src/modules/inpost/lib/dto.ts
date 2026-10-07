import type { ParcelDto, ParcelEventDto, PanelGroup, ParcelKind, ParcelSize, ParcelState, RunDto, WriterDto } from "./contract"
import type { LockerAddress } from "./lockers"
import { lockerMapUrl } from "./lockers"
import { formatMinor } from "./money"
import { isCancellable, isLabelAvailable, needsPayment, shipmentStage, trackingUrl, type ShipmentStage } from "./statuses"
import type { WriterState } from "./writers"

/**
 * Rows as the generated service returns them, and how the admin sees them.
 * Dates go out as ISO strings, money as "199.99".
 */

type When = Date | string | null | undefined

export interface ParcelRow {
  id: string
  order_id: string
  display_id: number | null
  fulfillment_id: string | null
  demo: boolean
  option_id: string
  kind: string
  cod: boolean
  service: string
  locker_code: string | null
  locker_name: string | null
  locker_address: LockerAddress | null
  parcel_size: string | null
  parcel_no: number
  cod_minor: number | null
  currency: string | null
  reference: string | null
  state: string
  status: string | null
  status_at: When
  shipment_id: string | null
  tracking_number: string | null
  sending_method: string | null
  plan_hash: string | null
  problems: Array<{ code: string; detail?: string }> | null
  skip_reason: string | null
  external: boolean
  error: string | null
  error_code: string | null
  attempts: number
  claim_token: string | null
  claimed_at: When
  lease_until: When
  created_by: string | null
  shipment_created_at: When
  offer: { id?: string | number; rate?: number | null; currency?: string | null; status?: string | null } | null
  buy_requested_at: When
  dispatch_state: string | null
  dispatch_order_id: string | null
  dispatch_error: string | null
  dispatch_at: When
  fulfillment_canceled_at: When
  shipped_marked_at: When
  delivered_marked_at: When
  status_writer_error: string | null
  last_checked_at: When
  created_at?: When
  updated_at?: When
  deleted_at?: When
}

export interface EventRow {
  id: string
  parcel_id: string | null
  order_id: string | null
  shipment_id: string | null
  kind: string
  status: string | null
  previous_status: string | null
  source: string | null
  message: string | null
  data: Record<string, unknown> | null
  actor: string | null
  dedupe_key: string | null
  demo: boolean
  occurred_at: When
  created_at?: When
}

export interface SettingRow {
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

const STATES: readonly ParcelState[] = ["pending", "creating", "created", "failed", "unknown", "skipped", "canceled"]

export function stateOf(v: string): ParcelState {
  return (STATES as readonly string[]).includes(v) ? (v as ParcelState) : "pending"
}

/** The Panel list a row belongs to. */
export function groupOf(state: string, status: string | null): PanelGroup | "canceled" | "skipped" {
  if (state === "pending" || state === "creating" || state === "failed" || state === "unknown") return "to_create"
  if (state === "skipped") return "skipped"
  if (state === "canceled") return "canceled"
  const stage: ShipmentStage = shipmentStage(status)
  switch (stage) {
    case "preparing":
    case "ready":
      return "waiting"
    case "in_transit":
      return "in_transit"
    case "in_locker":
      return "in_locker"
    case "delivered":
      return "delivered"
    case "problem":
    case "returned":
      return "problems"
    case "canceled":
      return "canceled"
  }
}

const sizeOf = (v: string | null): ParcelSize | null => (v === "small" || v === "medium" || v === "large" ? v : null)

export function toParcelDto(row: ParcelRow): ParcelDto {
  const state = stateOf(row.state)
  const created = state === "created"
  const kind: ParcelKind = row.kind === "courier" ? "courier" : "locker"
  const open = state === "pending" || state === "failed"
  const offer = row.offer && typeof row.offer === "object" && row.offer.id !== undefined && row.offer.id !== null
    ? { id: String(row.offer.id), rate: typeof row.offer.rate === "number" ? row.offer.rate : null, currency: row.offer.currency ?? null, status: row.offer.status ?? null }
    : null
  return {
    id: row.id,
    orderId: row.order_id,
    displayId: row.display_id ?? null,
    fulfillmentId: row.fulfillment_id ?? null,
    optionId: row.option_id,
    kind,
    cod: Boolean(row.cod),
    service: row.service,
    locker:
      kind === "locker" && row.locker_code
        ? { code: row.locker_code, name: row.locker_name ?? null, address: row.locker_address ?? null, mapUrl: lockerMapUrl({ code: row.locker_code, address: row.locker_address ?? null }) }
        : null,
    size: sizeOf(row.parcel_size),
    parcelNo: Number(row.parcel_no ?? 1) || 1,
    codAmount: row.cod_minor === null || row.cod_minor === undefined ? null : formatMinor(Number(row.cod_minor)),
    currency: row.currency ?? null,
    reference: row.reference ?? null,
    state,
    status: row.status ?? null,
    stage: row.status ? shipmentStage(row.status) : null,
    group: groupOf(state, row.status ?? null),
    statusAt: iso(row.status_at),
    shipmentId: row.shipment_id ?? null,
    trackingNumber: row.tracking_number ?? null,
    trackingUrl: row.tracking_number && !row.demo ? trackingUrl(row.tracking_number) : null,
    sendingMethod: row.sending_method ?? null,
    problems: Array.isArray(row.problems) ? row.problems.filter((p) => p && typeof p.code === "string") : [],
    skipReason: row.skip_reason ?? null,
    external: Boolean(row.external),
    error: row.error ?? null,
    errorCode: row.error_code ?? null,
    attempts: Number(row.attempts ?? 0),
    createdBy: row.created_by ?? null,
    shipmentCreatedAt: iso(row.shipment_created_at),
    offer,
    dispatch: row.dispatch_state ? { state: row.dispatch_state, orderId: row.dispatch_order_id ?? null, error: row.dispatch_error ?? null, at: iso(row.dispatch_at) } : null,
    fulfillmentCanceledAt: iso(row.fulfillment_canceled_at),
    shippedMarkedAt: iso(row.shipped_marked_at),
    deliveredMarkedAt: iso(row.delivered_marked_at),
    statusWriterError: row.status_writer_error ?? null,
    lastCheckedAt: iso(row.last_checked_at),
    demo: Boolean(row.demo),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    actions: {
      plan: open,
      create: state === "pending",
      cancel: created && !row.external && isCancellable(row.status),
      buy: created && !row.external && needsPayment(row.status),
      label: created && Boolean(row.shipment_id) && isLabelAvailable(row.status),
      refresh: created && Boolean(row.shipment_id),
      changeLocker: open && kind === "locker",
      changeSize: open,
      retry: state === "failed",
      lookup: state === "unknown",
      link: state === "pending" || state === "failed" || state === "unknown" || state === "skipped",
      skip: open,
    },
  }
}

export function toEventDto(row: EventRow): ParcelEventDto {
  return {
    id: row.id,
    parcelId: row.parcel_id ?? null,
    orderId: row.order_id ?? null,
    shipmentId: row.shipment_id ?? null,
    kind: row.kind,
    status: row.status ?? null,
    previousStatus: row.previous_status ?? null,
    source: row.source ?? null,
    message: row.message ?? null,
    data: row.data && typeof row.data === "object" ? row.data : null,
    actor: row.actor ?? null,
    occurredAt: iso(row.occurred_at) ?? new Date(0).toISOString(),
    demo: Boolean(row.demo),
  }
}

export function toRunDto(row: EventRow): RunDto {
  const counts: Record<string, number> = {}
  const data = row.data && typeof row.data === "object" ? row.data : {}
  for (const [k, v] of Object.entries(data)) if (typeof v === "number") counts[k] = v
  return { id: row.id, trigger: row.source ?? "schedule", occurredAt: iso(row.occurred_at) ?? new Date(0).toISOString(), message: row.message ?? null, counts }
}

export function toWriterDto(state: WriterState, names: Record<string, string>): WriterDto {
  return {
    key: state.key,
    allowed: state.allowed,
    on: state.on,
    armed: state.armed,
    updatedBy: state.updatedBy ? (names[state.updatedBy] ?? state.updatedBy) : null,
    updatedAt: state.updatedAt,
  }
}
