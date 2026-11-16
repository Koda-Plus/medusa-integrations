/**
 * A `ceneo_order` row for the admin. Pure.
 */

import type { BidDto, CeneoOrderDto, CeneoOrderItemDto } from "./contract"
import type { OrderItemRow } from "./kup-teraz"
import { importStateOf, type CeneoWrites, type ImportStatus } from "./order-input"

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null)
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

const IMPORT_STATUSES: readonly string[] = ["importing", "imported", "held", "failed"]

export function toCeneoOrderDto(r: Record<string, unknown>, stateNames: ReadonlyMap<number, string> = new Map(), importStates: readonly number[] = []): CeneoOrderDto {
  const items: CeneoOrderItemDto[] = Array.isArray(r.items)
    ? (r.items as OrderItemRow[]).map((i) => ({ shopProductId: i.shop_product_id ?? null, name: i.name ?? null, price: n(i.price), quantity: n(i.quantity) ?? 0, total: n(i.total), returned: n(i.returned) ?? 0, variantId: i.variant_id ?? null }))
    : []
  const a = (r.amounts && typeof r.amounts === "object" ? r.amounts : {}) as Record<string, unknown>
  const stateId = n(r.state_id)
  const w = (r.ceneo_writes && typeof r.ceneo_writes === "object" ? r.ceneo_writes : {}) as CeneoWrites
  const status = typeof r.import_status === "string" && IMPORT_STATUSES.includes(r.import_status) ? (r.import_status as ImportStatus) : null
  const medusaOrderId = typeof r.medusa_order_id === "string" ? r.medusa_order_id : null
  return {
    id: String(r.id),
    ceneoOrderId: String(r.ceneo_order_id ?? ""),
    number: typeof r.displayed_order_id === "string" ? r.displayed_order_id : null,
    shopOrderId: typeof r.shop_order_id === "string" ? r.shop_order_id : null,
    stateId,
    state: stateId !== null ? (stateNames.get(stateId) ?? null) : null,
    orderedAt: iso(r.ordered_at),
    amounts: { order: n(a.order), products: n(a.products), delivery: n(a.delivery) },
    deliveryForm: typeof r.delivery_form === "string" ? r.delivery_form : null,
    items,
    matched: r.matched === true,
    problems: Array.isArray(r.problems) ? (r.problems as Array<{ code: string; detail?: string }>) : [],
    medusaOrderId,
    importState: importStateOf({ import_status: status, medusa_order_id: medusaOrderId, state_id: stateId, matched: r.matched === true }, importStates),
    importError: typeof r.import_error === "string" ? r.import_error : null,
    importAttempts: n(r.import_attempts) ?? 0,
    importedAt: iso(r.imported_at),
    writes: {
      shopOrderIdAt: w.shop_order_id_at ?? null,
      confirmedAt: w.confirmed_at ?? null,
      tracking: w.shipment?.tracking ?? null,
      shipmentAt: w.shipment?.sent_at ?? null,
      sentAt: w.sent_at ?? null,
      cancelAt: w.cancel?.sent_at ?? null,
      cancelQueued: Boolean(w.cancel && !w.cancel.sent_at),
      canceledByCeneoAt: w.canceled_by_ceneo_at ?? null,
      error: w.error ?? null,
      attention: w.attention ?? null,
    },
    demo: r.demo === true,
    syncedAt: iso(r.synced_at),
  }
}

const REASONS: readonly string[] = ["clamped_max", "clamped_step", "below_min"]

/** A `ceneo_bid` row for the admin. */
export function toBidDto(r: Record<string, unknown>): BidDto {
  const lowest = (r.lowest_price && typeof r.lowest_price === "object" ? r.lowest_price : {}) as Record<string, unknown>
  return {
    id: String(r.id),
    kind: r.kind === "category" ? "category" : "product",
    key: String(r.key ?? ""),
    name: typeof r.name === "string" ? r.name : null,
    ceneoProductId: typeof r.ceneo_product_id === "string" ? r.ceneo_product_id : null,
    currentBid: n(r.current_bid),
    clickRate: n(r.click_rate),
    minSuggestedBid: n(r.min_suggested_bid),
    targetBid: n(r.target_bid),
    plannedBid: n(r.planned_bid),
    planReasons: Array.isArray(r.plan_reasons) ? (r.plan_reasons.filter((x) => typeof x === "string" && REASONS.includes(x)) as BidDto["planReasons"]) : [],
    targetBy: typeof r.target_by === "string" ? r.target_by : null,
    promoText: typeof r.promo_text === "string" ? r.promo_text : null,
    promoApplied: typeof r.promo_applied === "string" ? r.promo_applied : null,
    promoPending: r.promo_pending === true,
    top10: Array.isArray(r.top10) ? (r.top10 as BidDto["top10"]) : [],
    offersNumber: n(r.offers_number),
    position: n(r.position),
    lowestPrice: n(lowest.amount),
    appliedAt: iso(r.applied_at),
    error: typeof r.error === "string" ? r.error : null,
    readAt: iso(r.read_at),
  }
}
