import { DELIVERY_TYPES, type DeliveryType } from "./constants"
import type { DeliveryMapping, ShippingOptionLite } from "./contract"

/**
 * WHICH MEDUSA SHIPPING OPTION a delivery chosen in the InPost app becomes.
 * The admin maps each InPost Pay delivery type (APM = parcel locker,
 * COURIER, DIGITAL) to a shipping option of the store. Pure functions.
 */

export const EMPTY_MAPPING: DeliveryMapping = { APM: null, COURIER: null, DIGITAL: null }

export function isDeliveryType(v: unknown): v is DeliveryType {
  return typeof v === "string" && (DELIVERY_TYPES as readonly string[]).includes(v)
}

/** A clean mapping: only the three types, only `so_...` ids. */
export function normalizeMapping(v: unknown): DeliveryMapping {
  const out: DeliveryMapping = { ...EMPTY_MAPPING }
  if (!v || typeof v !== "object" || Array.isArray(v)) return out
  for (const type of DELIVERY_TYPES) {
    const id = (v as Record<string, unknown>)[type]
    out[type] = typeof id === "string" && /^so_[A-Za-z0-9]+$/.test(id.trim()) ? id.trim() : null
  }
  return out
}

export type PickResult = { ok: true; id: string; fallback: boolean } | { ok: false; code: "DELIVERY_NOT_MAPPED" | "DELIVERY_NOT_AVAILABLE" | "NO_SHIPPING_OPTION"; message: string }

/**
 * The shipping option for one order. The mapped option wins when the cart
 * can use it. Without a mapping, demo mode takes the first option the cart
 * can use; sandbox and live refuse, so a courier price never lands on a
 * parcel locker order by accident.
 */
export function pickShippingOption(input: { type: DeliveryType; mapping: DeliveryMapping; available: ShippingOptionLite[]; demo: boolean }): PickResult {
  const mapped = input.mapping[input.type]
  if (mapped) {
    if (input.available.some((o) => o.id === mapped)) return { ok: true, id: mapped, fallback: false }
    if (!input.demo) return { ok: false, code: "DELIVERY_NOT_AVAILABLE", message: `The shipping option mapped to ${input.type} (${mapped}) is not available for this cart` }
  }
  if (input.demo) {
    const first = input.available[0]
    if (first) return { ok: true, id: first.id, fallback: true }
    return { ok: false, code: "NO_SHIPPING_OPTION", message: "The cart has no shipping option" }
  }
  return { ok: false, code: "DELIVERY_NOT_MAPPED", message: `No shipping option is mapped to the InPost Pay delivery ${input.type} (Settings, Delivery)` }
}

/**
 * The delivery types the basket offers in the app: the mapped ones the cart
 * can use (demo: APM on the first option when nothing is mapped).
 */
export function offeredDeliveries(mapping: DeliveryMapping, available: ShippingOptionLite[], demo: boolean): Array<{ type: DeliveryType; optionId: string }> {
  const out: Array<{ type: DeliveryType; optionId: string }> = []
  for (const type of DELIVERY_TYPES) {
    const id = mapping[type]
    if (id && available.some((o) => o.id === id)) out.push({ type, optionId: id })
  }
  if (out.length === 0 && demo && available[0]) out.push({ type: "APM", optionId: available[0].id })
  return out
}

/**
 * The data of the shipping method. For a parcel locker it carries the
 * locker in the shape the InPost plugin of Koda Plus (and the InPost
 * geowidget) uses, `machine_id`, so that plugin can ship it.
 */
export function shippingMethodData(type: DeliveryType, point: string | null): Record<string, unknown> {
  const data: Record<string, unknown> = { inpost_pay: true, inpost_pay_delivery_type: type }
  if (type === "APM" && point) {
    data.machine_id = point
    data.machine_name = point
  }
  return data
}

/** A parcel locker code as InPost writes it (KRA01M, WAW123A, POP-WAW1). */
export function safeLockerCode(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : ""
  return /^[A-Z]{2,6}(?:-[A-Z]{2,6})?\d{1,5}[A-Z]{0,5}$/.test(s) ? s : null
}
