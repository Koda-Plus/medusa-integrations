import { isPolishPostCode, normalizePostCode, splitStreet } from "./address"
import { OPTION_SPECS, type InpostOptionId, type OptionSpec, type ParcelKind, type ParcelSize } from "./constants"
import { isLockerCode, lockerData, lockerFromData, type Locker } from "./lockers"

/**
 * WHAT THE FULFILLMENT PROVIDER DOES WITH DATA, as pure functions (the
 * provider in `src/providers/inpost` only wraps them):
 *
 *   the four fulfillment options, with the `type` and `cod` fields earlier
 *   InPost storefronts read from the shipping option data;
 *
 *   the option of a shipping option, by its `data.id` (the contract with
 *   existing shipping options), else by `type` and `cod` for data written by
 *   older scripts;
 *
 *   the checks at checkout: a locker option needs a locker code of the right
 *   shape, a courier option a full Polish address, cash on delivery a cart in
 *   PLN. The answer is the method data the order keeps, in one shape.
 */

export interface FulfillmentOptionData {
  id: InpostOptionId
  name: string
  description: string
  kind: ParcelKind
  cod: boolean
  service: string
  /** For storefronts built for the earlier InPost provider: "paczkomat" or "kurier". */
  type: "paczkomat" | "kurier"
  [k: string]: unknown
}

export function fulfillmentOptions(): FulfillmentOptionData[] {
  return OPTION_SPECS.map((s) => ({ id: s.id, name: s.name, description: s.description, kind: s.kind, cod: s.cod, service: s.service, type: s.legacyType }))
}

/** The option a shipping option stands for, or null when it is not one of ours. */
export function specOf(optionData: Record<string, unknown> | null | undefined): OptionSpec | null {
  if (!optionData || typeof optionData !== "object") return null
  const byId = OPTION_SPECS.find((s) => s.id === optionData.id)
  if (byId) return byId
  if (optionData.id !== undefined && optionData.id !== null && optionData.id !== "") return null
  const type = String(optionData.type ?? optionData.kind ?? "").toLowerCase()
  const kind: ParcelKind | null = type === "paczkomat" || type === "locker" ? "locker" : type === "kurier" || type === "courier" ? "courier" : null
  if (!kind) return null
  const cod = optionData.cod === true || optionData.cod === "true"
  return OPTION_SPECS.find((s) => s.kind === kind && s.cod === cod) ?? null
}

export function isOptionId(v: unknown): v is InpostOptionId {
  return OPTION_SPECS.some((s) => s.id === v)
}

/** The method data an order keeps, the same for every storefront. */
export interface MethodData {
  /** The legacy fields first: earlier storefronts and widgets read them. */
  type: "paczkomat" | "kurier"
  cod: boolean
  machine_id: string | null
  machine_name: string | null
  machine_address: Locker["address"]
  /** Ours. */
  inpost_option: InpostOptionId
  inpost_kind: ParcelKind
  inpost_service: string
  /** A parcel size the storefront chose (rare), else null: the store default applies. */
  inpost_parcel_size: ParcelSize | null
  [k: string]: unknown
}

export type CheckoutErrorCode = "option_unknown" | "locker_missing" | "locker_invalid" | "address_incomplete" | "country_unsupported" | "currency_unsupported"

export interface CheckoutError {
  code: CheckoutErrorCode
  message: string
}

const MESSAGES: Record<CheckoutErrorCode, string> = {
  option_unknown: "This shipping option is not an InPost option of this store.",
  locker_missing: "Choose an InPost parcel locker for this delivery.",
  locker_invalid: "The parcel locker code is not valid. Choose the locker on the map again.",
  address_incomplete: "InPost couriers need the street, the building number, the city and a postal code like 00-950.",
  country_unsupported: "InPost couriers deliver in Poland only.",
  currency_unsupported: "Cash on delivery with InPost is possible for orders in PLN only.",
}

export function checkoutError(code: CheckoutErrorCode): CheckoutError {
  return { code, message: MESSAGES[code] }
}

export interface CheckoutContext {
  currency_code?: string | null
  shipping_address?: {
    address_1?: string | null
    address_2?: string | null
    city?: string | null
    postal_code?: string | null
    country_code?: string | null
  } | null
}

function sizeOf(v: unknown): ParcelSize | null {
  const s = String(v ?? "").toLowerCase()
  return s === "small" || s === "medium" || s === "large" ? s : null
}

/**
 * The checks at checkout (validateFulfillmentData). Pure: the provider turns
 * an error into a MedusaError with the message, and a storefront may show it.
 * The locker's existence is checked apart (`verifyLockers`, a network call).
 */
export function validateMethodData(
  optionData: Record<string, unknown> | null | undefined,
  data: Record<string, unknown> | null | undefined,
  context: CheckoutContext | null | undefined,
): { ok: true; spec: OptionSpec; data: MethodData; locker: Locker | null } | { ok: false; error: CheckoutError } {
  const spec = specOf(optionData)
  if (!spec) return { ok: false, error: checkoutError("option_unknown") }
  const input = data && typeof data === "object" ? data : {}
  if (spec.cod) {
    const currency = String(context?.currency_code ?? "").toLowerCase()
    if (currency && currency !== "pln") return { ok: false, error: checkoutError("currency_unsupported") }
  }
  let locker: Locker | null = null
  if (spec.kind === "locker") {
    locker = lockerFromData(input)
    if (!locker) return { ok: false, error: checkoutError("locker_missing") }
    if (!isLockerCode(locker.code)) return { ok: false, error: checkoutError("locker_invalid") }
  } else {
    const a = context?.shipping_address
    if (a) {
      const country = String(a.country_code ?? "").toUpperCase()
      if (country && country !== "PL") return { ok: false, error: checkoutError("country_unsupported") }
      const street = splitStreet(a.address_1, a.address_2)
      const post = normalizePostCode(a.postal_code, "PL")
      if (!street || !String(a.city ?? "").trim() || !isPolishPostCode(post)) return { ok: false, error: checkoutError("address_incomplete") }
    }
  }
  return { ok: true, spec, locker, data: methodDataFor(spec, locker, sizeOf(input.inpost_parcel_size ?? input.parcel_size)) }
}

export function methodDataFor(spec: OptionSpec, locker: Locker | null, size: ParcelSize | null = null): MethodData {
  const lockerFields = locker ? lockerData(locker) : { machine_id: null, machine_name: null, machine_address: null }
  return {
    type: spec.legacyType,
    cod: spec.cod,
    ...(lockerFields as Pick<MethodData, "machine_id" | "machine_name" | "machine_address">),
    inpost_option: spec.id,
    inpost_kind: spec.kind,
    inpost_service: spec.service,
    inpost_parcel_size: size,
  }
}

/**
 * The option, locker and size a fulfillment carries, read back from its data
 * (ours, or the shape of an earlier InPost provider). Null when the data
 * names no InPost option at all.
 */
export function readFulfillmentData(data: Record<string, unknown> | null | undefined): { spec: OptionSpec; locker: Locker | null; size: ParcelSize | null } | null {
  if (!data || typeof data !== "object") return null
  const spec =
    OPTION_SPECS.find((s) => s.id === data.inpost_option) ??
    specOf({ type: data.inpost_kind ?? data.type, cod: data.cod })
  if (!spec) return null
  return { spec, locker: spec.kind === "locker" ? lockerFromData(data) : null, size: sizeOf(data.inpost_parcel_size) }
}
