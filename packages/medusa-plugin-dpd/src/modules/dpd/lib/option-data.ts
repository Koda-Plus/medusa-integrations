import {
  DEFAULT_COD_COUNTRIES,
  EU_COUNTRIES,
  OPTION_SPECS,
  PICKUP_COD_COUNTRY,
  PUDO_ID_PATTERN,
  type DpdOptionId,
  type OptionKind,
  type OptionSpec,
} from "./constants"
import { isPolishPostalCode, normalizePostalCode } from "./sender"

/**
 * WHAT THE FULFILLMENT PROVIDER DOES WITH DATA, as pure functions (the
 * provider in `src/providers/dpd` only wraps them):
 *
 *   the five fulfillment options, the return option flagged `is_return`;
 *
 *   the option of a shipping option, by its `data.id` (the contract with the
 *   shipping options of the store); any other id is not ours;
 *
 *   the checks at checkout: the destination must be one of `countries`, a
 *   courier option needs a complete address, a Pickup option a point id of
 *   the right shape and a phone or an e-mail of the recipient (DPD sends the
 *   collection notice), cash on delivery a currency `codCountries` allows
 *   for the country, and at a Pickup point only in Poland. The answer is the
 *   method data the order keeps, in one shape, with `dpd_*` keys;
 *
 *   the data read back from a fulfillment or a shipping method, in that
 *   shape or in the shape of the shipping option (a claim, an exchange, an
 *   order edit or a draft order never runs the checks), and the DPD method
 *   of an order with several.
 *
 * Whether the point exists and is active is a MyPudoAPI call (stage 3), not
 * done here.
 */

export type FulfillmentOptionData = {
  id: DpdOptionId
  name: string
  description: string
  kind: OptionKind
  cod: boolean
  is_return: boolean
  [k: string]: unknown
}

export function fulfillmentOptions(): FulfillmentOptionData[] {
  return OPTION_SPECS.map((s) => ({ id: s.id, name: s.name, description: s.description, kind: s.kind, cod: s.cod, is_return: s.kind === "return" }))
}

/** The option a shipping option stands for, by its `data.id`, or null when it is not one of ours. */
export function specOf(optionData: Record<string, unknown> | null | undefined): OptionSpec | null {
  if (!optionData || typeof optionData !== "object") return null
  return OPTION_SPECS.find((s) => s.id === optionData.id) ?? null
}

export function isOptionId(v: unknown): v is DpdOptionId {
  return OPTION_SPECS.some((s) => s.id === v)
}

/** The method data an order keeps (shipping method, then fulfillment data). */
export type MethodData = {
  dpd_option: DpdOptionId
  dpd_kind: OptionKind
  dpd_cod: boolean
  /** The Pickup point id, upper case (PL14509); null for a courier or a return. */
  dpd_pudo_id: string | null
  /** The destination country (ISO alpha-2) when known at checkout. */
  dpd_country: string | null
  [k: string]: unknown
}

export type CheckoutErrorCode =
  | "option_unknown"
  | "return_not_selectable"
  | "country_unsupported"
  | "address_incomplete"
  | "pudo_missing"
  | "pudo_invalid"
  | "contact_missing"
  | "cod_country_unsupported"
  | "cod_currency_unsupported"
  | "cod_pickup_abroad"

export type CheckoutError = {
  code: CheckoutErrorCode
  message: string
}

const MESSAGES: Record<CheckoutErrorCode, string> = {
  option_unknown: "This shipping option is not a DPD option of this store.",
  return_not_selectable: "The DPD return option is for returns only and cannot be chosen at checkout.",
  country_unsupported: "This store does not ship with DPD to this country.",
  address_incomplete: "DPD couriers need the street with the number, the city and the postal code (like 00-950 in Poland).",
  pudo_missing: "Choose a DPD Pickup point for this delivery.",
  pudo_invalid: "The DPD Pickup point id is not valid. Choose the point on the map again.",
  contact_missing: "DPD Pickup needs the recipient's phone or e-mail for the collection notice.",
  cod_country_unsupported: "Cash on delivery with DPD is not available for this country.",
  cod_currency_unsupported: "Cash on delivery with DPD is not available in this currency for this country.",
  cod_pickup_abroad: "Cash on delivery at a DPD Pickup point is possible in Poland only.",
}

export function checkoutError(code: CheckoutErrorCode): CheckoutError {
  return { code, message: MESSAGES[code] }
}

/** The part of Medusa's context (the cart, or a return, claim or exchange) the checks read. */
export type CheckoutContext = {
  currency_code?: string | null
  email?: string | null
  customer?: { email?: string | null } | null
  shipping_address?: {
    address_1?: string | null
    address_2?: string | null
    city?: string | null
    postal_code?: string | null
    country_code?: string | null
    phone?: string | null
  } | null
  /** Set when Medusa validates the shipping method of a return, a claim or an exchange. */
  return_id?: string | null
  claim_id?: string | null
  exchange_id?: string | null
  [k: string]: unknown
}

/** The store rules the checks need (from the resolved options). */
export type CheckoutRules = {
  countries: readonly string[]
  codCountries: Readonly<Record<string, readonly string[]>>
}

export const DEFAULT_RULES: CheckoutRules = { countries: EU_COUNTRIES, codCountries: DEFAULT_COD_COUNTRIES }

/** "pl 14509" and "pl14509" become "PL14509". */
export function normalizePudoId(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, "").toUpperCase()
}

export function isPudoId(id: string): boolean {
  return PUDO_ID_PATTERN.test(id)
}

/** The point id the storefront sent (`pudo_id`), or the one an earlier check stored (`dpd_pudo_id`); null when none. */
export function pudoIdFromData(data: Record<string, unknown> | null | undefined): string | null {
  if (!data || typeof data !== "object") return null
  const raw = data.pudo_id ?? data.dpd_pudo_id
  if (typeof raw !== "string" && typeof raw !== "number") return null
  const id = normalizePudoId(raw)
  return id || null
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

function isRmaContext(context: CheckoutContext | null | undefined): boolean {
  return Boolean(context && (text(context.return_id) || text(context.claim_id) || text(context.exchange_id)))
}

/**
 * The checks at checkout (validateFulfillmentData). Pure: the provider turns
 * an error into a MedusaError with the message, and a storefront may show it.
 * A missing context (no cart yet) skips the checks that need it; the plan
 * checks the address again when it is built.
 *
 * The return option is refused at checkout. Medusa also validates the
 * shipping method of a return, claim or exchange; that context carries
 * `return_id`, `claim_id` or `exchange_id`, and there the return option is
 * the right one.
 */
export function validateMethodData(
  optionData: Record<string, unknown> | null | undefined,
  data: Record<string, unknown> | null | undefined,
  context: CheckoutContext | null | undefined,
  rules: CheckoutRules = DEFAULT_RULES,
): { ok: true; spec: OptionSpec; data: MethodData } | { ok: false; error: CheckoutError } {
  const spec = specOf(optionData)
  if (!spec) return { ok: false, error: checkoutError("option_unknown") }
  if (spec.kind === "return") {
    if (!isRmaContext(context)) return { ok: false, error: checkoutError("return_not_selectable") }
    return { ok: true, spec, data: methodDataFor(spec) }
  }
  const checked = checkMethodData(spec, data, context, rules)
  const [first] = checked.errors
  if (first) return { ok: false, error: first }
  return { ok: true, spec, data: methodDataFor(spec, { pudoId: checked.pudoId, country: checked.country }) }
}

/**
 * Every check of the checkout that fails for a courier or a Pickup option, in
 * the order the checkout runs them (the first one is the error the checkout
 * gives). The recording runs them again against the order: Medusa does not
 * check the method again when the address changes after checkout, and a
 * claim, an exchange, an order edit or a draft order never asks for them.
 * A check that only follows from an earlier failure is left out: a point
 * that is missing has no country, a country the store does not ship to has
 * no cash on delivery.
 */
export function checkMethodData(
  spec: OptionSpec,
  data: Record<string, unknown> | null | undefined,
  context: CheckoutContext | null | undefined,
  rules: CheckoutRules = DEFAULT_RULES,
): { errors: CheckoutError[]; pudoId: string | null; country: string | null } {
  const errors: CheckoutError[] = []
  const input = data && typeof data === "object" ? data : {}
  const address = context?.shipping_address ?? null
  let pudoId: string | null = null
  let country: string | null = null
  if (spec.kind === "pickup") {
    pudoId = pudoIdFromData(input)
    if (!pudoId) errors.push(checkoutError("pudo_missing"))
    else if (!isPudoId(pudoId)) errors.push(checkoutError("pudo_invalid"))
    else country = pudoId.slice(0, 2) /* the parcel goes to the point: its country is the prefix of the id */
  } else {
    country = text(address?.country_code).toUpperCase() || null
  }
  if (country && !rules.countries.includes(country)) errors.push(checkoutError("country_unsupported"))
  else if (spec.cod) {
    const currency = text(context?.currency_code).toUpperCase()
    const allowed = country ? rules.codCountries[country] : null
    if (spec.kind === "pickup" && country && country !== PICKUP_COD_COUNTRY) errors.push(checkoutError("cod_pickup_abroad"))
    else if (country && !allowed) errors.push(checkoutError("cod_country_unsupported"))
    else if (currency) {
      const currencies = allowed ?? Object.values(rules.codCountries).flat()
      if (!currencies.includes(currency)) errors.push(checkoutError("cod_currency_unsupported"))
    }
  }
  if (spec.kind === "courier" && address) {
    const postal = normalizePostalCode(address.postal_code, country ?? "PL")
    const complete = Boolean(text(address.address_1) && text(address.city) && postal && country)
    if (!complete || (country === "PL" && !isPolishPostalCode(postal))) errors.push(checkoutError("address_incomplete"))
  }
  if (spec.kind === "pickup" && context) {
    const contact = text(address?.phone) || text(context.email) || text(context.customer?.email)
    if (!contact) errors.push(checkoutError("contact_missing"))
  }
  return { errors, pudoId, country }
}

export function methodDataFor(spec: OptionSpec, v: { pudoId?: string | null; country?: string | null } = {}): MethodData {
  return {
    dpd_option: spec.id,
    dpd_kind: spec.kind,
    dpd_cod: spec.cod,
    dpd_pudo_id: spec.kind === "pickup" ? (v.pudoId ?? null) : null,
    dpd_country: v.country ?? null,
  }
}

export type ReadMethod = { spec: OptionSpec; pudoId: string | null; country: string | null }

/**
 * The option, point and country a fulfillment carries, read back from its
 * data: the method data of the checkout (`dpd_option`), or else the data of
 * the shipping option itself (`id`, with `kind` and `cod`). Medusa copies the
 * option data into the shipping method of a claim, an exchange, an order
 * edit or a draft order without asking the provider to check it, so that
 * shape names no point and no country. Null when the data names no DPD
 * option.
 */
export function readFulfillmentData(data: Record<string, unknown> | null | undefined): ReadMethod | null {
  if (!data || typeof data !== "object") return null
  const spec = OPTION_SPECS.find((s) => s.id === data.dpd_option) ?? specOf(data)
  if (!spec) return null
  const country = text(data.dpd_country).toUpperCase()
  return {
    spec,
    pudoId: spec.kind === "pickup" ? pudoIdFromData(data) : null,
    country: /^[A-Z]{2}$/.test(country) ? country : null,
  }
}

/** A shipping method as the flows read it from Query. */
export type MethodLike = {
  data?: Record<string, unknown> | null
  shipping_option_id?: string | null
}

/**
 * The DPD shipping method of an order. An order can hold several (the
 * checkout, then a claim or an exchange): given the shipping option of a
 * fulfillment, the methods of that option, of them the one the checkout
 * validated (`dpd_option`, the one with the point) before the first; without
 * an option, or when no method has it, the same rule over all DPD methods.
 * Null when the order has no DPD method.
 */
export function pickDpdMethod<M extends MethodLike>(methods: readonly M[] | null | undefined, shippingOptionId?: string | null): { method: M; read: ReadMethod } | null {
  const ours: Array<{ method: M; read: ReadMethod }> = []
  for (const method of methods ?? []) {
    const read = method ? readFulfillmentData(method.data ?? null) : null
    if (read) ours.push({ method, read })
  }
  const optionId = text(shippingOptionId)
  const ofOption = optionId ? ours.filter((m) => m.method.shipping_option_id === optionId) : []
  const pool = ofOption.length > 0 ? ofOption : ours
  return pool.find((m) => isOptionId(m.method.data?.dpd_option)) ?? pool[0] ?? null
}
