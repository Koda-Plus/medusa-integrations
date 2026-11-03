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

export type PickResult =
  | { ok: true; id: string; fallback: boolean }
  | { ok: false; code: "DELIVERY_NOT_MAPPED" | "DELIVERY_NOT_AVAILABLE" | "NO_SHIPPING_OPTION" | "COD_NOT_AVAILABLE" | "PREPAID_ON_COD_OPTION"; message: string }

/**
 * Cash on delivery. The InPost plugin of Koda Plus ships COD from its own
 * fulfillment options (`data.id` "inpost-paczkomat-cod", "inpost-kurier-cod"),
 * each the twin of a prepaid one. A COD order goes on the twin of the mapped
 * option, a paid order never on a COD option (the customer would pay twice).
 * Other carriers get no COD: the plugin cannot know that they collect it.
 */
const COD_TWINS: Record<string, string> = { "inpost-paczkomat": "inpost-paczkomat-cod", "inpost-kurier": "inpost-kurier-cod" }

export function codVariant(option: ShippingOptionLite, available: ShippingOptionLite[], cod: boolean): ShippingOptionLite | null {
  const id = option.data_id ?? ""
  const prepaidOf = Object.keys(COD_TWINS).find((k) => COD_TWINS[k] === id)
  const isCod = prepaidOf !== undefined
  if (cod === isCod) return option
  if (!COD_TWINS[id] && !isCod) return cod ? null : option
  const wanted = cod ? COD_TWINS[id] : prepaidOf
  return available.find((o) => o.data_id === wanted && o.provider_id === option.provider_id) ?? null
}

/**
 * The shipping option for one order. The mapped option wins when the cart
 * can use it. Without a mapping, demo mode takes the first option the cart
 * can use; sandbox and live refuse, so a courier price never lands on a
 * parcel locker order by accident. Then the COD twin, as above.
 */
export function pickShippingOption(input: { type: DeliveryType; mapping: DeliveryMapping; available: ShippingOptionLite[]; demo: boolean; cod?: boolean }): PickResult {
  const mapped = input.mapping[input.type]
  let base: { option: ShippingOptionLite; fallback: boolean } | null = null
  if (mapped) {
    const option = input.available.find((o) => o.id === mapped)
    if (option) base = { option, fallback: false }
    else if (!input.demo) return { ok: false, code: "DELIVERY_NOT_AVAILABLE", message: `The shipping option mapped to ${input.type} (${mapped}) is not available for this cart` }
  }
  if (!base && input.demo) {
    const first = input.available[0]
    if (!first) return { ok: false, code: "NO_SHIPPING_OPTION", message: "The cart has no shipping option" }
    base = { option: first, fallback: true }
  }
  if (!base) return { ok: false, code: "DELIVERY_NOT_MAPPED", message: `No shipping option is mapped to the InPost Pay delivery ${input.type} (Settings, Delivery)` }
  const cod = input.cod === true
  const variant = codVariant(base.option, input.available, cod)
  if (!variant) {
    return cod
      ? { ok: false, code: "COD_NOT_AVAILABLE", message: `Cash on delivery needs the COD twin of the InPost option mapped to ${input.type}, and the cart cannot use one` }
      : { ok: false, code: "PREPAID_ON_COD_OPTION", message: `The option mapped to ${input.type} is a cash on delivery option and has no prepaid twin for this cart` }
  }
  return { ok: true, id: variant.id, fallback: base.fallback }
}

export interface OfferedDelivery {
  type: DeliveryType
  optionId: string
  /** The COD twin the app may offer as the "COD" delivery option, or null. */
  codOptionId: string | null
}

/**
 * The delivery types the basket offers in the app: the mapped ones the cart
 * can use (demo: APM on the first option when nothing is mapped), with the
 * COD twin when the cart can use one.
 */
export function offeredDeliveries(mapping: DeliveryMapping, available: ShippingOptionLite[], demo: boolean): OfferedDelivery[] {
  const out: OfferedDelivery[] = []
  const add = (type: DeliveryType, option: ShippingOptionLite) => {
    const prepaid = codVariant(option, available, false)
    if (!prepaid) return
    const cod = codVariant(prepaid, available, true)
    out.push({ type, optionId: prepaid.id, codOptionId: cod && cod.id !== prepaid.id ? cod.id : null })
  }
  for (const type of DELIVERY_TYPES) {
    const option = available.find((o) => o.id === mapping[type])
    if (option) add(type, option)
  }
  if (out.length === 0 && demo && available[0]) out.push({ type: "APM", optionId: available[0].id, codOptionId: null })
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
