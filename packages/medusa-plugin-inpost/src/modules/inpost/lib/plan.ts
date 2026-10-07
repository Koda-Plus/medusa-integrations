import { createHash } from "node:crypto"
import { displayName, isEmail, isPolishPostCode, normalizePhone, normalizePostCode, splitStreet } from "./address"
import { MAX_WEIGHT_KG, SIZE_DIMENSIONS_MM, SIZE_LETTER, type InpostService, type ParcelKind, type ParcelSize, type SendingMethod } from "./constants"
import { shippedOutsideKey } from "./guards"
import { isLockerCode, type LockerAddress } from "./lockers"
import { firstMinor, formatMinor, minorToAmount, toMinor } from "./money"
import { referenceFor, type ResolvedInpostOptions } from "./options"
import type { EffectiveSettings } from "./settings"

/**
 * THE PLAN A PERSON READS BEFORE A SHIPMENT IS CREATED, and the exact ShipX
 * request it turns into. Pure: the order comes in as Medusa's Query returns
 * it, nothing is read or written here.
 *
 * Built fresh from the order every time (the receiver, the address, the
 * total), so a fix made in Medusa shows in the next plan. What the person
 * confirms is the plan's `hash`: the create route refuses a hash that no
 * longer matches the plan of that moment ("the plan changed, read it again").
 *
 * ShipX rules applied here (ShipX documentation, "Tworzenie przesyłki w
 * trybie uproszczonym"):
 *   - a locker shipment needs the receiver's phone and e-mail and
 *     `custom_attributes.target_point`, one parcel (lockers do not take
 *     multi parcel shipments), a template small / medium / large;
 *   - a courier shipment needs the receiver's phone, a company or a first and
 *     last name, an address with the street and the building number apart,
 *     and real dimensions and a weight;
 *   - cash on delivery comes with insurance of at least the same amount
 *     (required for courier services); both are the order's gross total;
 *   - the reference has 3 to 100 characters;
 *   - the sender is optional: without it ShipX uses the organization's data.
 */

export interface PlanOrderAddress {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  postal_code?: string | null
  country_code?: string | null
  phone?: string | null
}

export interface PlanOrder {
  id: string
  display_id?: number | null
  status?: string | null
  email?: string | null
  customer?: { email?: string | null } | null
  currency_code?: string | null
  total?: unknown
  raw_total?: unknown
  summary?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  shipping_address?: PlanOrderAddress | null
  items?: Array<{ id: string; quantity?: unknown; variant?: { weight?: unknown } | null }> | null
  payment_collections?: Array<{ captured_amount?: unknown } | null> | null
}

/**
 * The order fields a plan reads, in `query.graph` syntax. `total` is the
 * gross total Medusa computes (items, shipping and tax, minus discounts).
 */
export const PLAN_ORDER_FIELDS: readonly string[] = [
  "id",
  "display_id",
  "status",
  "email",
  "currency_code",
  "total",
  "metadata",
  "created_at",
  "customer.email",
  "shipping_address.*",
  "items.id",
  "items.quantity",
  "items.variant.weight",
  "payment_collections.captured_amount",
  "shipping_methods.id",
  "shipping_methods.name",
  "shipping_methods.data",
  "shipping_methods.shipping_option_id",
  "fulfillments.id",
  "fulfillments.provider_id",
  "fulfillments.data",
  "fulfillments.canceled_at",
  "fulfillments.shipped_at",
  "fulfillments.delivered_at",
  "fulfillments.items.line_item_id",
  "fulfillments.items.quantity",
]

export interface PlanRow {
  id: string
  order_id: string
  fulfillment_id: string | null
  kind: ParcelKind
  cod: boolean
  service: InpostService
  locker_code: string | null
  locker_name: string | null
  locker_address: LockerAddress | null
  parcel_size: ParcelSize | null
  /** 1 for the first InPost parcel of the order, 2 for the second... */
  parcel_no: number
  demo: boolean
  fulfillment_canceled_at?: Date | string | null
  /** The fulfillment's items, for the weight. Null: every item of the order. */
  items?: Array<{ line_item_id: string; quantity: unknown }> | null
}

export interface PlanContext {
  options: ResolvedInpostOptions
  settings: EffectiveSettings
  /** Demo mode: a receiver without a phone or an e-mail gets sample ones, marked as such. */
  demo?: boolean
}

export interface ShipxAddress {
  street: string
  building_number: string
  flat_number?: string
  city: string
  post_code: string
  country_code: string
}

export interface ShipxPerson {
  company_name?: string
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  address?: ShipxAddress
}

export type ShipxParcel =
  | { id: string; template: ParcelSize; weight: { amount: number; unit: "kg" } }
  | { id: string; dimensions: { length: number; width: number; height: number; unit: "mm" }; weight: { amount: number; unit: "kg" }; is_non_standard: false }

export interface ShipxCreatePayload {
  service: InpostService
  reference: string
  receiver: ShipxPerson
  sender?: ShipxPerson
  parcels: ShipxParcel[]
  custom_attributes?: { target_point?: string; sending_method?: string; dropoff_point?: string }
  cod?: { amount: number; currency: "PLN" }
  insurance?: { amount: number; currency: "PLN" }
}

/** A courier pickup (ShipX dispatch order) from the sender's address, once InPost confirms the shipment. */
export interface PickupPlan {
  name: string
  phone: string
  email: string | null
  address: ShipxAddress
}

export type PlanProblemCode =
  | "order_missing"
  | "order_canceled"
  | "fulfillment_canceled"
  | "shipped_outside"
  | "locker_missing"
  | "locker_invalid"
  | "phone_missing"
  | "phone_invalid"
  | "email_missing"
  | "email_invalid"
  | "name_missing"
  | "address_missing"
  | "address_no_building"
  | "city_missing"
  | "post_code_missing"
  | "post_code_invalid"
  | "country_unsupported"
  | "cod_currency"
  | "cod_amount_unknown"
  | "cod_zero"
  | "too_heavy"
  | "pickup_sender_missing"

export type PlanWarningCode = "weight_estimated" | "order_paid" | "sender_organization" | "sample_contact" | "parcel_size_default"

export interface PlanNote<C extends string> {
  code: C
  detail?: string
}

export interface Plan {
  ok: boolean
  kind: ParcelKind
  service: InpostService
  receiver: {
    name: string
    phone: string | null
    email: string | null
    address: ShipxAddress | null
    /** Demo mode filled a missing phone or e-mail with a sample. */
    sample: boolean
  }
  locker: { code: string; name: string | null; address: LockerAddress | null } | null
  parcel: { size: ParcelSize; letter: "A" | "B" | "C"; weightKg: number; weightEstimated: boolean; dimensionsMm: { length: number; width: number; height: number } }
  /** Grosze and the string "199.99"; null without cash on delivery. */
  cod: { minor: number; amount: string; currency: "PLN" } | null
  insurance: { minor: number; amount: string; currency: "PLN" } | null
  reference: string
  sendingMethod: SendingMethod | null
  dropoffPoint: string | null
  /** Sent: the sender from Settings or the options. Null: InPost uses the organization's data. */
  sender: ShipxPerson | null
  pickup: PickupPlan | null
  /** A prepaid account: when ShipX prepares offers instead of buying one, the offer of this service is bought. */
  buysOffer: true
  problems: Array<PlanNote<PlanProblemCode>>
  warnings: Array<PlanNote<PlanWarningCode>>
  /** The exact body of POST /v1/organizations/:id/shipments, or null when the plan has problems. */
  request: ShipxCreatePayload | null
  /** What a person confirms: changes whenever the request or the pickup would change. */
  hash: string
}

const SAMPLE_PHONE = "000000000"
const SAMPLE_EMAIL = "customer@example.com"

const clean = (v: unknown, max = 100): string => (typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "")

/** Canonical JSON: keys sorted at every level, so equal plans hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

export function planHash(parts: { request: ShipxCreatePayload | null; pickup: PickupPlan | null; rowId: string }): string {
  return createHash("sha256").update(canonicalJson({ v: 1, ...parts })).digest("hex").slice(0, 24)
}

/** The parcel weight in kg from the variants (grams by default), or the default when any is unknown. */
export function parcelWeight(
  order: PlanOrder,
  rowItems: PlanRow["items"],
  unit: "g" | "kg",
  fallbackKg: number,
): { kg: number; estimated: boolean } {
  const lines = order.items ?? []
  const wanted = rowItems && rowItems.length > 0 ? rowItems : lines.map((l) => ({ line_item_id: l.id, quantity: l.quantity }))
  let sum = 0
  let unknown = wanted.length === 0
  for (const w of wanted) {
    const line = lines.find((l) => l.id === w.line_item_id)
    const qty = Number(w.quantity ?? line?.quantity ?? 0)
    const weight = Number(line?.variant?.weight)
    if (!line || !Number.isFinite(weight) || weight <= 0 || !Number.isFinite(qty)) {
      unknown = true
      continue
    }
    sum += (unit === "kg" ? weight : weight / 1000) * qty
  }
  const kg = unknown ? Math.max(sum, fallbackKg) : sum
  return { kg: Math.max(0.1, Math.round(kg * 1000) / 1000), estimated: unknown }
}

/** The order's gross total in grosze: the current total of the summary when present, else the order total. */
export function orderTotalMinor(order: PlanOrder): number | null {
  const s = order.summary ?? {}
  return firstMinor(s.raw_current_order_total, s.current_order_total, order.raw_total, order.total)
}

/** What was already captured on the order, in grosze (a paid order should not be collected again). */
export function capturedMinor(order: PlanOrder | null): number {
  let sum = 0
  for (const pc of order?.payment_collections ?? []) sum += toMinor(pc?.captured_amount) ?? 0
  return sum
}

export function buildPlan(row: PlanRow, order: PlanOrder | null, ctx: PlanContext): Plan {
  const o = ctx.options
  const problems: Array<PlanNote<PlanProblemCode>> = []
  const warnings: Array<PlanNote<PlanWarningCode>> = []
  const size: ParcelSize = row.parcel_size ?? ctx.settings.defaultParcelSize
  const sendingMethod = row.kind === "locker" ? o.sendingMethod.locker : o.sendingMethod.courier
  const dropoffPoint = sendingMethod === "parcel_locker" && o.dropoffPoint ? o.dropoffPoint : null

  if (!order) problems.push({ code: "order_missing" })
  if (order && order.status === "canceled") problems.push({ code: "order_canceled" })
  if (row.fulfillment_canceled_at) problems.push({ code: "fulfillment_canceled" })
  const outsideKey = order ? shippedOutsideKey(order.metadata, o.skipMetadataKeys) : null
  if (outsideKey) problems.push({ code: "shipped_outside", detail: outsideKey })

  const a: PlanOrderAddress = order?.shipping_address ?? {}
  const sample = Boolean(ctx.demo)
  let usedSample = false
  let phone = normalizePhone(a.phone)
  if (!phone && sample) {
    phone = SAMPLE_PHONE
    usedSample = true
  }
  const rawEmail = clean(order?.email ?? order?.customer?.email, 254)
  let email = isEmail(rawEmail) ? rawEmail : null
  if (!email && sample) {
    email = SAMPLE_EMAIL
    usedSample = true
  }
  /* Problems are stored on the row for the Panel: they never carry the receiver's data (the plan shows it). */
  if (!phone) problems.push({ code: String(a.phone ?? "").trim() ? "phone_invalid" : "phone_missing" })

  const firstName = clean(a.first_name, 60)
  const lastName = clean(a.last_name, 60)
  const company = clean(a.company, 100)
  const receiver: ShipxPerson = {
    ...(company ? { company_name: company } : {}),
    ...(firstName ? { first_name: firstName } : {}),
    ...(lastName ? { last_name: lastName } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  }

  let receiverAddress: ShipxAddress | null = null
  if (row.kind === "locker") {
    if (!row.locker_code) problems.push({ code: "locker_missing" })
    else if (!isLockerCode(row.locker_code)) problems.push({ code: "locker_invalid", detail: row.locker_code })
    if (!email) problems.push({ code: rawEmail ? "email_invalid" : "email_missing" })
  } else {
    if (!company && !(firstName && lastName)) problems.push({ code: "name_missing" })
    const country = clean(a.country_code, 2).toUpperCase() || "PL"
    if (country !== "PL") problems.push({ code: "country_unsupported", detail: country })
    if (!clean(a.address_1) && !clean(a.address_2)) problems.push({ code: "address_missing" })
    const street = splitStreet(a.address_1, a.address_2)
    if ((clean(a.address_1) || clean(a.address_2)) && !street) problems.push({ code: "address_no_building" })
    const city = clean(a.city, 60)
    if (!city) problems.push({ code: "city_missing" })
    const postCode = normalizePostCode(a.postal_code, country)
    if (!clean(a.postal_code, 20)) problems.push({ code: "post_code_missing" })
    else if (!isPolishPostCode(postCode)) problems.push({ code: "post_code_invalid" })
    if (street && city) receiverAddress = { ...street, city, post_code: postCode, country_code: country }
    if (receiverAddress) receiver.address = receiverAddress
  }

  let cod: Plan["cod"] = null
  let insurance: Plan["insurance"] = null
  if (row.cod) {
    const currency = clean(order?.currency_code, 3).toUpperCase()
    const minor = order ? orderTotalMinor(order) : null
    if (order && currency && currency !== "PLN") problems.push({ code: "cod_currency", detail: currency })
    else if (order && minor === null) problems.push({ code: "cod_amount_unknown" })
    else if (minor !== null && minor <= 0) problems.push({ code: "cod_zero" })
    else if (minor !== null) {
      cod = { minor, amount: formatMinor(minor), currency: "PLN" }
      insurance = { minor, amount: formatMinor(minor), currency: "PLN" }
      const paid = capturedMinor(order)
      if (paid > 0 && paid >= minor) warnings.push({ code: "order_paid", detail: formatMinor(paid) })
    }
  }

  const weight = order ? parcelWeight(order, row.items, o.weightUnit, o.defaultWeightKg) : { kg: o.defaultWeightKg, estimated: true }
  if (weight.estimated) warnings.push({ code: "weight_estimated", detail: String(weight.kg) })
  if (weight.kg > MAX_WEIGHT_KG[row.kind]) problems.push({ code: "too_heavy", detail: `${weight.kg} kg > ${MAX_WEIGHT_KG[row.kind]} kg` })
  if (!row.parcel_size) warnings.push({ code: "parcel_size_default", detail: size })

  const s = ctx.settings.sender
  let sender: ShipxPerson | null = null
  if (ctx.settings.senderSent) {
    sender = {
      ...(s.companyName ? { company_name: s.companyName } : {}),
      ...(s.firstName ? { first_name: s.firstName } : {}),
      ...(s.lastName ? { last_name: s.lastName } : {}),
      email: s.email,
      phone: s.phone,
      ...(ctx.settings.senderAddress
        ? {
            address: {
              street: s.street,
              building_number: s.buildingNumber,
              ...(s.flatNumber ? { flat_number: s.flatNumber } : {}),
              city: s.city,
              post_code: s.postCode,
              country_code: "PL",
            },
          }
        : {}),
    }
  } else {
    warnings.push({ code: "sender_organization" })
  }

  let pickup: PickupPlan | null = null
  if (sendingMethod === "dispatch_order") {
    const name = s.companyName || [s.firstName, s.lastName].filter(Boolean).join(" ")
    if (!ctx.settings.senderAddress || !s.phone || !name) problems.push({ code: "pickup_sender_missing" })
    else {
      pickup = {
        name,
        phone: s.phone,
        email: s.email || null,
        address: {
          street: s.street,
          building_number: s.buildingNumber,
          ...(s.flatNumber ? { flat_number: s.flatNumber } : {}),
          city: s.city,
          post_code: s.postCode,
          country_code: "PL",
        },
      }
    }
  }

  if (usedSample) warnings.push({ code: "sample_contact" })

  const reference = referenceFor(o.referenceTemplate, {
    displayId: typeof order?.display_id === "number" ? order.display_id : null,
    orderId: row.order_id,
    fulfillmentId: row.fulfillment_id,
    parcelNo: row.parcel_no,
  })

  const dims = SIZE_DIMENSIONS_MM[size]
  const weightField = { amount: weight.kg, unit: "kg" as const }
  const parcel: ShipxParcel =
    row.kind === "locker"
      ? { id: "1", template: size, weight: weightField }
      : { id: "1", dimensions: { ...dims, unit: "mm" }, weight: weightField, is_non_standard: false }

  const customAttributes = {
    ...(row.kind === "locker" && row.locker_code ? { target_point: row.locker_code } : {}),
    ...(sendingMethod ? { sending_method: sendingMethod } : {}),
    ...(dropoffPoint ? { dropoff_point: dropoffPoint } : {}),
  }

  const ok = problems.length === 0
  const request: ShipxCreatePayload | null = ok
    ? {
        service: row.service,
        reference,
        receiver,
        ...(sender ? { sender } : {}),
        parcels: [parcel],
        ...(Object.keys(customAttributes).length > 0 ? { custom_attributes: customAttributes } : {}),
        ...(cod ? { cod: { amount: minorToAmount(cod.minor), currency: "PLN" as const } } : {}),
        ...(insurance ? { insurance: { amount: minorToAmount(insurance.minor), currency: "PLN" as const } } : {}),
      }
    : null

  return {
    ok,
    kind: row.kind,
    service: row.service,
    receiver: { name: displayName(a), phone, email, address: receiverAddress, sample: usedSample },
    locker: row.kind === "locker" && row.locker_code ? { code: row.locker_code, name: row.locker_name, address: row.locker_address } : null,
    parcel: { size, letter: SIZE_LETTER[size], weightKg: weight.kg, weightEstimated: weight.estimated, dimensionsMm: dims },
    cod,
    insurance,
    reference,
    sendingMethod,
    dropoffPoint,
    sender,
    pickup,
    buysOffer: true,
    problems,
    warnings,
    request,
    hash: planHash({ request, pickup, rowId: row.id }),
  }
}
