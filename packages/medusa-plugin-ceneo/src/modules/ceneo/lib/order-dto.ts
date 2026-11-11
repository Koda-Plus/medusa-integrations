/**
 * A `ceneo_order` row for the admin. Pure.
 */

import type { CeneoOrderDto, CeneoOrderItemDto } from "./contract"
import type { OrderItemRow } from "./kup-teraz"

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null)
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

export function toCeneoOrderDto(r: Record<string, unknown>, stateNames: ReadonlyMap<number, string> = new Map()): CeneoOrderDto {
  const items: CeneoOrderItemDto[] = Array.isArray(r.items)
    ? (r.items as OrderItemRow[]).map((i) => ({ shopProductId: i.shop_product_id ?? null, name: i.name ?? null, price: n(i.price), quantity: n(i.quantity) ?? 0, total: n(i.total), returned: n(i.returned) ?? 0, variantId: i.variant_id ?? null }))
    : []
  const a = (r.amounts && typeof r.amounts === "object" ? r.amounts : {}) as Record<string, unknown>
  const stateId = n(r.state_id)
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
    medusaOrderId: typeof r.medusa_order_id === "string" ? r.medusa_order_id : null,
    demo: r.demo === true,
    syncedAt: iso(r.synced_at),
  }
}
