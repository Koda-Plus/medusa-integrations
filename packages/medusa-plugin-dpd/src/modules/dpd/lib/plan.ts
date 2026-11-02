import { createHash } from "node:crypto"
import { DEMO_PAYER_FID, DPD_TEXT_LIMITS, OPTION_SPECS, REFERENCE_MAX, type OptionKind } from "./constants"
import type { PlanWarningDto, ProblemDto } from "./contract"
import { boxesForPlan, roundKg, type BoxesSource, type PlanBox, type StoredBoxes } from "./boxes"
import { codFor, type CodPlan } from "./cod"
import { DEMO_SENDER } from "./demo"
import type { DpdAddress, DpdPackage, DpdParcel, DpdSessionType, GeneratePackagesNumbersRequest } from "./dpdservices"
import type { ResolvedDpdOptions } from "./options"
import { hasSender, isEmail, normalizePhone, normalizePostalCode, senderFor, validateSender, type ResolvedSender } from "./sender"

/**
 * THE PLAN A PERSON READS BEFORE A SHIPMENT IS CREATED, and the exact
 * generatePackagesNumbers request it turns into. Pure: the order comes in as
 * Medusa's Query returns it (PLAN_ORDER_FIELDS), nothing is read or written
 * here.
 *
 * Built fresh from the order every time. The receiver (name, phone, e-mail,
 * street) is read live from the shipping address and goes only into the
 * request and the plan answer (no-store), never into a table. The hash
 * covers the whole request and the row id: confirming a plan sends exactly
 * what the person read, and any change of the order in between (address,
 * phone, total, boxes) asks them to read it again. Warnings, problems, the
 * label page and display only fields are outside the hash.
 *
 * Stage 2 creates courier shipments in Poland. A Pickup option or a return
 * gives option_later, an address abroad abroad_later; nothing of those goes
 * to DPD.
 */

export type PlanOrderAddress = {
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

/** The order as a plan reads it (a subset of what Query returns for PLAN_ORDER_FIELDS). */
export type PlanOrder = {
  id: string
  display_id?: number | null
  status?: string | null
  email?: string | null
  currency_code?: string | null
  total?: unknown
  raw_total?: unknown
  summary?: { raw_current_order_total?: unknown; current_order_total?: unknown } | null
  customer?: { email?: string | null } | null
  shipping_address?: PlanOrderAddress | null
  items?: Array<{ id: string; quantity?: unknown; variant?: { weight?: unknown } | null }> | null
  payment_collections?: Array<{
    captured_amount?: unknown
    payments?: Array<{ provider_id?: string | null; canceled_at?: unknown } | null> | null
  } | null> | null
}

/**
 * The fields Query reads for a plan. `summary` (not `summary.*`): the order
 * module turns it into summary.totals and flattens it onto order.summary
 * (E15).
 */
export const PLAN_ORDER_FIELDS: readonly string[] = [
  "id", "display_id", "status", "email", "currency_code", "total", "created_at", "summary",
  "customer.email", "shipping_address.*",
  "items.id", "items.quantity", "items.variant.weight",
  "payment_collections.captured_amount", "payment_collections.payments.provider_id", "payment_collections.payments.canceled_at",
  "shipping_methods.id", "shipping_methods.name", "shipping_methods.data", "shipping_methods.shipping_option_id",
  "fulfillments.id", "fulfillments.provider_id", "fulfillments.shipping_option_id", "fulfillments.location_id",
  "fulfillments.data", "fulfillments.canceled_at", "fulfillments.shipped_at", "fulfillments.delivered_at",
  "fulfillments.items.line_item_id", "fulfillments.items.quantity",
]

/** The row as a plan reads it (planRowOf in workflows/dpd/plan.ts builds it). */
export type PlanRow = {
  id: string
  kind: "outbound" | "return"
  optionId: string
  pudoId: string | null
  /** dpd_shipment.reference: the fulfillment id. */
  reference: string | null
  boxes: StoredBoxes | null
  fulfillment: {
    id: string
    canceledAt: unknown
    shippedAt: unknown
    deliveredAt: unknown
    locationId: string | null
    /** Null: every item of the order. */
    items: Array<{ line_item_id: string; quantity: unknown }> | null
  } | null
}

export type PlanContext = {
  options: ResolvedDpdOptions
  demo: boolean
  codCarrier?: boolean
}

export type PlanProblemCode =
  | "order_missing"
  | "order_canceled"
  | "fulfillment_canceled"
  | "fulfillment_shipped"
  | "fulfillment_delivered"
  | "option_unknown"
  | "option_later"
  | "abroad_later"
  | "country_unsupported"
  | "address_incomplete"
  | "receiver_name_missing"
  | "receiver_too_long"
  | "sender_missing"
  | "sender_invalid"
  | "payer_fid_missing"
  | "reference_too_long"
  | "weight_missing"
  | "box_invalid"
  | "too_many_boxes"
  | "cod_country_unsupported"
  | "cod_currency_unsupported"
  | "cod_paid_online"
  | "cod_amount_unknown"
  | "cod_zero"

export type PlanWarningCode =
  | "weight_default_box"
  | "order_paid"
  | "cod_on_other_parcel"
  | "receiver_phone_missing"
  | "receiver_phone_invalid"
  | "courier_over_50kg"
  | "sample_sender"

export const PLAN_PROBLEM_CODES: readonly PlanProblemCode[] = [
  "order_missing",
  "order_canceled",
  "fulfillment_canceled",
  "fulfillment_shipped",
  "fulfillment_delivered",
  "option_unknown",
  "option_later",
  "abroad_later",
  "country_unsupported",
  "address_incomplete",
  "receiver_name_missing",
  "receiver_too_long",
  "sender_missing",
  "sender_invalid",
  "payer_fid_missing",
  "reference_too_long",
  "weight_missing",
  "box_invalid",
  "too_many_boxes",
  "cod_country_unsupported",
  "cod_currency_unsupported",
  "cod_paid_online",
  "cod_amount_unknown",
  "cod_zero",
]

export const PLAN_WARNING_CODES: readonly PlanWarningCode[] = [
  "weight_default_box",
  "order_paid",
  "cod_on_other_parcel",
  "receiver_phone_missing",
  "receiver_phone_invalid",
  "courier_over_50kg",
  "sample_sender",
]

export type Plan = {
  /** No problems: request is set and may be sent. */
  ok: boolean
  optionId: string
  kind: OptionKind | null
  cod: boolean
  sessionType: DpdSessionType | null
  country: string | null
  receiver: DpdAddress | null
  sender: DpdAddress | null
  senderLocationId: string | null
  boxes: PlanBox[]
  boxesSource: BoxesSource
  codDue: CodPlan | null
  /** The package reference (the fulfillment id). */
  reference: string
  /** The parcel references, one per box: `${reference}-${n}`, n from 1. */
  parcelReferences: string[]
  problems: ProblemDto[]
  warnings: PlanWarningDto[]
  /** The exact body of generatePackagesNumbers, or null when there are problems. */
  request: GeneratePackagesNumbersRequest | null
  hash: string
}

/** JSON with the keys of every object sorted and undefined values left out: the same value gives the same text. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

/** sha256(canonicalJson({ v: 1, request, rowId })) hex, first 24 characters. */
export function planHash(parts: { request: GeneratePackagesNumbersRequest | null; rowId: string }): string {
  return createHash("sha256").update(canonicalJson({ v: 1, request: parts.request, rowId: parts.rowId })).digest("hex").slice(0, 24)
}

export function parcelReference(reference: string, n: number): string {
  return `${reference}-${n}`
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "")

/** Over a DPD text limit: receiver_too_long with the field and its limit. Never cut. */
function tooLong(field: keyof typeof DPD_TEXT_LIMITS, value: string, path: string, out: ProblemDto[]): void {
  const max = DPD_TEXT_LIMITS[field]
  if (value.length > max) out.push({ code: "receiver_too_long", field: path, detail: `${path}, max ${max}` })
}

/** The receiver from the shipping address (spec 7.1), with its problems and warnings. */
export function receiverOf(order: PlanOrder): { receiver: DpdAddress | null; country: string | null; problems: ProblemDto[]; warnings: ProblemDto[] } {
  const problems: ProblemDto[] = []
  const warnings: ProblemDto[] = []
  const a = order.shipping_address
  if (!a) return { receiver: null, country: null, problems: [{ code: "address_incomplete", field: "shipping_address" }], warnings }
  const country = clean(a.country_code).toUpperCase() || null
  const name = clean(`${clean(a.first_name)} ${clean(a.last_name)}`)
  const company = clean(a.company)
  const address = clean(`${clean(a.address_1)} ${clean(a.address_2)}`)
  const city = clean(a.city)
  const postalCode = normalizePostalCode(a.postal_code, country ?? "PL")
  if (!name && !company) problems.push({ code: "receiver_name_missing", field: "receiver.name" })
  if (!clean(a.address_1)) problems.push({ code: "address_incomplete", field: "receiver.address" })
  if (!city) problems.push({ code: "address_incomplete", field: "receiver.city" })
  if (!country) problems.push({ code: "address_incomplete", field: "receiver.countryCode" })
  if (!postalCode || (country === "PL" && !/^\d{5}$/.test(postalCode))) problems.push({ code: "address_incomplete", field: "receiver.postalCode" })
  tooLong("company", company, "receiver.company", problems)
  tooLong("name", name, "receiver.name", problems)
  tooLong("address", address, "receiver.address", problems)
  tooLong("city", city, "receiver.city", problems)
  const receiver: DpdAddress = { address, city, countryCode: country ?? "", postalCode }
  if (company) receiver.company = company
  if (name) receiver.name = name
  const phoneRaw = clean(a.phone)
  if (!phoneRaw) warnings.push({ code: "receiver_phone_missing" })
  else {
    const phone = normalizePhone(phoneRaw, country ?? "PL")
    if (phone === null) warnings.push({ code: "receiver_phone_invalid" })
    else receiver.phone = phone
  }
  const email = [clean(order.email), clean(order.customer?.email)].find((e) => e !== "" && isEmail(e) && e.length <= DPD_TEXT_LIMITS.email)
  if (email) receiver.email = email
  return { receiver: orderedAddress(receiver), country, problems, warnings }
}

/** The address with its keys in the order of the DPD schema (readable when shown raw; the hash sorts them anyway). */
function orderedAddress(a: DpdAddress): DpdAddress {
  return {
    ...(a.company ? { company: a.company } : {}),
    ...(a.name ? { name: a.name } : {}),
    address: a.address,
    city: a.city,
    countryCode: a.countryCode,
    postalCode: a.postalCode,
    ...(a.phone ? { phone: a.phone } : {}),
    ...(a.email ? { email: a.email } : {}),
  }
}

function senderAddress(s: ResolvedSender): DpdAddress {
  return orderedAddress({
    ...(s.company ? { company: s.company } : {}),
    ...(s.name ? { name: s.name } : {}),
    address: s.street,
    city: s.city,
    countryCode: s.countryCode,
    postalCode: s.postalCode,
    ...(s.phone ? { phone: s.phone } : {}),
    ...(s.email ? { email: s.email } : {}),
  })
}

/** The sender of the fulfillment's stock location (senderFor), DEMO_SENDER in demo mode without one, checked with validateSender. */
export function senderOf(o: ResolvedDpdOptions, locationId: string | null, demo: boolean): { sender: DpdAddress | null; problems: ProblemDto[]; warnings: ProblemDto[] } {
  const own = locationId && o.senders[locationId] ? o.senders[locationId] : null
  const path = own ? `senders.${locationId}` : "sender"
  const s = own ?? senderFor(o, locationId)
  if (!hasSender(s)) {
    if (demo) return { sender: senderAddress(DEMO_SENDER), problems: [], warnings: [{ code: "sample_sender" }] }
    return { sender: null, problems: [{ code: "sender_missing", field: "sender" }], warnings: [] }
  }
  const problems: ProblemDto[] = validateSender(s, path).map((p) => ({
    code: "sender_invalid",
    field: p.path,
    detail: `${p.path}, ${p.code.replace(/_/g, " ")}${p.max !== undefined ? `, max ${p.max}` : ""}`,
  }))
  return { sender: senderAddress(s), problems, warnings: [] }
}

function isSetTime(v: unknown): boolean {
  return v !== null && v !== undefined && v !== ""
}

/** The plan of a row (spec 5.1.7): every problem collected, not only the first. */
export function buildPlan(row: PlanRow, order: PlanOrder | null, ctx: PlanContext): Plan {
  const o = ctx.options
  const problems: ProblemDto[] = []
  const warnings: PlanWarningDto[] = []
  /* E6: rows seeded in demo mode have no reference and no fulfillment; the row id stands in, and the claim stores it. */
  const reference = row.reference ?? row.fulfillment?.id ?? row.id
  const spec = OPTION_SPECS.find((s) => s.id === row.optionId) ?? null
  const base = {
    optionId: row.optionId,
    kind: spec?.kind ?? null,
    cod: spec?.cod ?? false,
    reference,
  }
  const stopped = (): Plan => ({
    ...base,
    ok: false,
    sessionType: null,
    country: null,
    receiver: null,
    sender: null,
    senderLocationId: null,
    boxes: [],
    boxesSource: "none",
    codDue: null,
    parcelReferences: [],
    problems,
    warnings,
    request: null,
    hash: planHash({ request: null, rowId: row.id }),
  })

  /* 1. the order */
  if (order === null) problems.push({ code: "order_missing" })
  else if (order.status === "canceled") problems.push({ code: "order_canceled" })
  /* 2. the fulfillment */
  const f = row.fulfillment
  if (f) {
    if (isSetTime(f.canceledAt)) problems.push({ code: "fulfillment_canceled" })
    if (isSetTime(f.shippedAt)) problems.push({ code: "fulfillment_shipped" })
    if (isSetTime(f.deliveredAt)) problems.push({ code: "fulfillment_delivered" })
  }
  /* 3. the option: stage 2 sends courier shipments only */
  if (!spec) {
    problems.push({ code: "option_unknown", detail: row.optionId })
    return stopped()
  }
  if (spec.kind !== "courier" || row.kind === "return") {
    problems.push({ code: "option_later" })
    return stopped()
  }
  if (order === null) return stopped()

  /* 4. the receiver */
  const rec = receiverOf(order)
  problems.push(...rec.problems)
  warnings.push(...rec.warnings)
  const country = rec.country
  if (country !== null) {
    if (!o.countries.includes(country)) problems.push({ code: "country_unsupported", detail: country })
    else if (country !== "PL") problems.push({ code: "abroad_later", detail: country })
  }
  /* 5. the sender */
  const locationId = f?.locationId ?? null
  const snd = senderOf(o, locationId, ctx.demo)
  problems.push(...snd.problems)
  warnings.push(...snd.warnings)
  /* Outside demo mode the payer is payerFid, else masterFid; without either the request would carry payerFID 0. */
  if (!ctx.demo && o.payerFid === null) problems.push({ code: "payer_fid_missing", field: "payerFid" })
  /* 6. the reference, with room for "-100" */
  if (reference.length > REFERENCE_MAX - 4) problems.push({ code: "reference_too_long", detail: `max ${REFERENCE_MAX - 4}` })
  /* 7. the boxes */
  const bx = boxesForPlan(row, order, { weightUnit: o.weightUnit, defaultBox: o.defaultBox })
  problems.push(...bx.problems)
  warnings.push(...bx.warnings)
  /* 8. cash on delivery */
  const cod = codFor({ optionCod: spec.cod, country, order, options: o, carrier: ctx.codCarrier })
  problems.push(...cod.problems)
  warnings.push(...cod.warnings)

  const parcelReferences = bx.boxes.map((_, i) => parcelReference(reference, i + 1))
  /* 9. the request, only without problems */
  let request: GeneratePackagesNumbersRequest | null = null
  if (problems.length === 0 && rec.receiver && snd.sender) {
    const parcels: DpdParcel[] = bx.boxes.map((b, i) => ({
      reference: parcelReferences[i],
      weight: roundKg(b.weightKg),
      ...(b.lengthCm !== null ? { sizeX: Math.round(b.lengthCm) } : {}),
      ...(b.widthCm !== null ? { sizeY: Math.round(b.widthCm) } : {}),
      ...(b.heightCm !== null ? { sizeZ: Math.round(b.heightCm) } : {}),
    }))
    const pkg: DpdPackage = {
      reference,
      ...(typeof order.display_id === "number" ? { ref1: String(order.display_id) } : {}),
      ...(order.id.length <= DPD_TEXT_LIMITS.ref ? { ref2: order.id } : {}),
      sender: snd.sender,
      receiver: rec.receiver,
      /* payer_fid_missing above: outside demo mode a request exists only with a payer FID. */
      payerFID: ctx.demo ? DEMO_PAYER_FID : (o.payerFid ?? 0),
      parcels,
      ...(cod.cod
        ? {
            services: [
              {
                code: "COD" as const,
                attributes: [
                  { code: "AMOUNT", value: cod.cod.amount },
                  { code: "CURRENCY", value: cod.cod.currency },
                ],
              },
            ],
          }
        : {}),
    }
    request = { generationPolicy: "STOP_ON_FIRST_ERROR", packages: [pkg] }
  }

  return {
    ...base,
    ok: request !== null,
    sessionType: country === null ? null : country === "PL" ? "DOMESTIC" : "INTERNATIONAL",
    country,
    receiver: rec.receiver,
    sender: snd.sender,
    senderLocationId: locationId && o.senders[locationId] ? locationId : null,
    boxes: bx.boxes,
    boxesSource: bx.source,
    codDue: cod.cod,
    parcelReferences,
    problems,
    warnings,
    request,
    hash: planHash({ request, rowId: row.id }),
  }
}
