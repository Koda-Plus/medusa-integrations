import { isEmail, isPolishPostCode, normalizePhone, normalizePostCode } from "./address"
import {
  DEFAULT_LABEL_SIZE,
  DEFAULT_PARCEL_SIZE,
  DEFAULT_POINTS_PER_MINUTE,
  DEFAULT_POLL_MAX_AGE_DAYS,
  DEFAULT_REFERENCE_TEMPLATE,
  DEFAULT_REQUESTS_PER_MINUTE,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WEIGHT_KG,
  LABEL_SIZES,
  MAX_REQUESTS_PER_MINUTE,
  PARCEL_SIZES,
  SENDING_METHODS,
  type LabelSize,
  type ParcelSize,
  type SendingMethod,
} from "./constants"
import { isLockerCode, normalizeLockerCode } from "./lockers"
import { normalizeReferences, type InpostReference, type InpostReferenceOption } from "./references"

/**
 * Options of `@koda-plus/medusa-plugin-inpost`. The SAME object goes to the
 * plugin (the data module, the admin, the routes and jobs) and to the
 * fulfillment provider:
 *
 *   const inpost = { apiToken: process.env.INPOST_API_TOKEN, ... }
 *   plugins: [{ resolve: "@koda-plus/medusa-plugin-inpost", options: inpost }]
 *   modules: [{ resolve: "@medusajs/medusa/fulfillment", options: { providers: [
 *     { resolve: "@koda-plus/medusa-plugin-inpost/providers/inpost", id: "inpost", options: inpost },
 *   ] } }]
 *
 * Every key is optional. Missing values never break the boot: without a token
 * the plugin runs in demo mode, and with `demo: false` and no token it
 * registers, says "not configured" in the admin and sends nothing. Numbers may
 * come as strings (environment variables), lists as comma separated strings.
 */

export interface InpostSenderOption {
  companyName?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  street?: string
  buildingNumber?: string
  flatNumber?: string
  city?: string
  postCode?: string
}

export interface InpostPluginOptions {
  /** ShipX API token (InPost Manager: My account, API, ShipX). Never leaves the server. */
  apiToken?: string
  /** The organization id shown next to the token in InPost Manager. */
  organizationId?: string | number
  /** The ShipX sandbox instead of production. Default false. */
  sandbox?: boolean | string
  /** Simulated shipments built from the store's orders; nothing goes to InPost. Default: true when apiToken is missing. */
  demo?: boolean | string
  /** HARD SWITCH of the ShipX writes (create, pay a prepaid offer, courier pickup, cancel). Default false (true in demo mode, simulated). */
  shipmentWriter?: boolean | string
  /** HARD SWITCH of the Medusa writes: mark the fulfillment shipped when InPost picks the parcel up, delivered when it is delivered. Default false (true in demo mode, simulated). */
  fulfillmentStatusWriter?: boolean | string
  /** With the shipment writer armed: create the shipment as soon as a fulfillment is created (true), or only by the button (false, default). */
  autoCreate?: boolean | string
  /** autoCreate takes only fulfillments recorded within this many hours (default 48), never a backlog. */
  autoCreateMaxAgeHours?: number | string
  /** Payment providers that mean "pay at the door" (default ["pp_system_default"]); a payment by any other provider blocks cash on delivery. */
  codPaymentProviders?: string[] | string
  /** Default parcel size: "small" (A), "medium" (B, default) or "large" (C). Changeable per shipment. */
  defaultParcelSize?: ParcelSize | "A" | "B" | "C" | string
  /** Label size: "A6" (default) or "A4". Courier labels exist only as A6. */
  labelFormat?: LabelSize | string
  /** The sender on the shipment and the courier pickup address. Default: none, InPost uses the organization's data. */
  sender?: InpostSenderOption
  /** ShipX `sending_method` per kind, like { locker: "parcel_locker", courier: "dispatch_order" }. Default: the account's own. */
  sendingMethod?: { locker?: string; courier?: string }
  /** The locker where you drop parcels off (`dropoff_point`), with sending method parcel_locker. */
  dropoffPoint?: string
  /** The shipment reference, 3 to 100 characters. Placeholders {display_id}, {order_id}, {fulfillment_id}. Default "Order {display_id}". */
  referenceTemplate?: string
  /** The unit of the variant weights in Medusa: "g" (default) or "kg". */
  weightUnit?: "g" | "kg" | string
  /** The parcel weight in kg when the variants have none. Default 1. */
  defaultWeightKg?: number | string
  /** Orders whose metadata holds any of these keys were shipped outside Medusa: no shipment is created. Default none. */
  skipMetadataKeys?: string[] | string
  /** Check at checkout that the chosen locker exists (public points API, cached, fails open). Default true. */
  verifyLockers?: boolean | string
  /** The secret part of the webhook URL (/hooks/inpost/<secret>): lowercase letters and digits, at least 24. Default: webhook off. */
  webhookSecret?: string
  /** The status pass every 15 minutes, the fallback of the webhook. Default true. */
  pollEnabled?: boolean | string
  /** Shipments older than this many days are no longer read. Default 30. */
  pollMaxAgeDays?: number | string
  /** Self-imposed rate limit towards ShipX. Default 60 per minute. */
  requestsPerMinute?: number | string
  /** Timeout of one ShipX request in ms. Default 20000. */
  timeoutMs?: number | string
  /** Requests per minute one IP may send to GET /store/inpost/points. Default 60. */
  pointsPerMinute?: number | string
  /** Stores running the integration, shown in the admin ("Running in production"). */
  references?: InpostReferenceOption[]
}

export interface ResolvedSender {
  companyName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  street: string
  buildingNumber: string
  flatNumber: string
  city: string
  postCode: string
}

export interface ResolvedInpostOptions {
  apiToken: string
  organizationId: string
  sandbox: boolean
  demo: boolean
  demoReason: "option" | "no_token" | null
  writers: { shipment: boolean; fulfillmentStatus: boolean }
  autoCreate: boolean
  autoCreateMaxAgeHours: number
  codPaymentProviders: string[]
  defaultParcelSize: ParcelSize
  labelFormat: LabelSize
  sender: ResolvedSender
  sendingMethod: { locker: SendingMethod | null; courier: SendingMethod | null }
  dropoffPoint: string | null
  referenceTemplate: string
  weightUnit: "g" | "kg"
  defaultWeightKg: number
  skipMetadataKeys: string[]
  verifyLockers: boolean
  webhookSecret: string
  /** The webhook secret is set but too short or not lowercase hex: the route stays closed. */
  webhookSecretInvalid: boolean
  pollEnabled: boolean
  pollMaxAgeDays: number
  requestsPerMinute: number
  timeoutMs: number
  pointsPerMinute: number
  references: InpostReference[]
  /** Values that were set but ignored, for the admin and the boot log. */
  problems: string[]
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "")

/** true / false from booleans and the usual strings; null when the value says neither. */
export function boolOrNull(v: unknown): boolean | null {
  if (typeof v === "boolean") return v
  if (typeof v === "string") {
    if (/^(1|true|yes|on)$/i.test(v.trim())) return true
    if (/^(0|false|no|off)$/i.test(v.trim())) return false
  }
  return null
}

function bounded(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

function textList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map((x) => str(x)) : typeof v === "string" ? v.split(",").map((x) => x.trim()) : []
  return [...new Set(raw.filter(Boolean))].slice(0, 20)
}

/** "small", "medium", "large" or the letters A, B, C. */
export function parcelSize(v: unknown): ParcelSize | null {
  const s = str(v).toLowerCase()
  if ((PARCEL_SIZES as readonly string[]).includes(s)) return s as ParcelSize
  if (s === "a") return "small"
  if (s === "b") return "medium"
  if (s === "c") return "large"
  return null
}

export function labelSize(v: unknown): LabelSize | null {
  const s = str(v).toUpperCase()
  return (LABEL_SIZES as readonly string[]).includes(s) ? (s as LabelSize) : null
}

export function sendingMethod(v: unknown): SendingMethod | null {
  const s = str(v).toLowerCase()
  return (SENDING_METHODS as readonly string[]).includes(s) ? (s as SendingMethod) : null
}

/** A ShipX organization id: digits only. */
export function organizationId(v: unknown): string {
  const s = str(v)
  return /^\d{1,12}$/.test(s) ? s : ""
}

/** Lowercase letters and digits, at least 24: InPost wants the webhook path in lower case. */
export function isWebhookSecret(s: string): boolean {
  return /^[a-z0-9]{24,128}$/.test(s)
}

/** The sender as typed, cleaned: a phone that is not nine Polish digits and a broken e-mail are dropped. */
export function resolveSender(v: unknown): ResolvedSender {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const email = str(o.email)
  return {
    companyName: str(o.companyName).slice(0, 100),
    firstName: str(o.firstName).slice(0, 60),
    lastName: str(o.lastName).slice(0, 60),
    email: isEmail(email) ? email : "",
    phone: normalizePhone(o.phone) ?? "",
    street: str(o.street).slice(0, 100),
    buildingNumber: str(o.buildingNumber).slice(0, 20),
    flatNumber: str(o.flatNumber).slice(0, 20),
    city: str(o.city).slice(0, 60),
    postCode: normalizePostCode(o.postCode),
  }
}

/** The sender has what ShipX needs to use it instead of the organization's data: an e-mail and a phone. */
export function senderComplete(s: ResolvedSender): boolean {
  return Boolean(s.email && s.phone)
}

/** The sender has a full address (a courier pickup needs one). */
export function senderAddressComplete(s: ResolvedSender): boolean {
  return Boolean(s.street && s.buildingNumber && s.city && isPolishPostCode(s.postCode))
}

export function resolveOptions(o: InpostPluginOptions | undefined | null): ResolvedInpostOptions {
  const opts = o ?? {}
  const problems: string[] = []
  const apiToken = str(opts.apiToken)
  const demoOption = boolOrNull(opts.demo)
  /* Demo only when asked for: a missing token on production must never turn real fulfillments into sample rows. */
  const demo = demoOption === true
  const writerSwitch = (v: unknown, name: string): boolean => {
    const b = boolOrNull(v)
    if (v !== undefined && v !== null && v !== "" && b === null) problems.push(`${name} (true or false)`)
    return b ?? demo
  }
  const size = parcelSize(opts.defaultParcelSize)
  if (opts.defaultParcelSize !== undefined && !size) problems.push("defaultParcelSize (small, medium or large)")
  const label = labelSize(opts.labelFormat)
  if (opts.labelFormat !== undefined && !label) problems.push("labelFormat (A6 or A4)")
  const methods = opts.sendingMethod && typeof opts.sendingMethod === "object" ? opts.sendingMethod : {}
  const locker = sendingMethod(methods.locker)
  const courier = sendingMethod(methods.courier)
  if (methods.locker !== undefined && !locker) problems.push("sendingMethod.locker")
  if (methods.courier !== undefined && !courier) problems.push("sendingMethod.courier")
  const dropoff = normalizeLockerCode(opts.dropoffPoint)
  if (dropoff && !isLockerCode(dropoff)) problems.push("dropoffPoint (a locker code like KRA01M)")
  const reference = str(opts.referenceTemplate)
  const org = organizationId(opts.organizationId)
  if (str(opts.organizationId) && !org) problems.push("organizationId (digits only)")
  const secret = str(opts.webhookSecret)
  const secretInvalid = Boolean(secret) && !isWebhookSecret(secret)
  if (secretInvalid) problems.push("webhookSecret (at least 24 lowercase letters and digits)")
  const unit = str(opts.weightUnit).toLowerCase()
  const weight = Number(str(opts.defaultWeightKg).replace(",", "."))
  return {
    apiToken,
    organizationId: org,
    sandbox: boolOrNull(opts.sandbox) === true,
    demo,
    demoReason: demo ? "option" : null,
    writers: {
      shipment: writerSwitch(opts.shipmentWriter, "shipmentWriter"),
      fulfillmentStatus: writerSwitch(opts.fulfillmentStatusWriter, "fulfillmentStatusWriter"),
    },
    autoCreate: boolOrNull(opts.autoCreate) === true,
    autoCreateMaxAgeHours: bounded(opts.autoCreateMaxAgeHours, 48, 1, 720),
    codPaymentProviders: opts.codPaymentProviders === undefined ? ["pp_system_default"] : textList(opts.codPaymentProviders),
    defaultParcelSize: size ?? DEFAULT_PARCEL_SIZE,
    labelFormat: label ?? DEFAULT_LABEL_SIZE,
    sender: resolveSender(opts.sender),
    sendingMethod: { locker, courier },
    dropoffPoint: dropoff && isLockerCode(dropoff) ? dropoff : null,
    referenceTemplate: reference.length >= 1 && reference.length <= 100 ? reference : DEFAULT_REFERENCE_TEMPLATE,
    weightUnit: unit === "kg" ? "kg" : "g",
    defaultWeightKg: Number.isFinite(weight) && weight > 0 && weight <= 30 ? Math.round(weight * 1000) / 1000 : DEFAULT_WEIGHT_KG,
    skipMetadataKeys: textList(opts.skipMetadataKeys),
    verifyLockers: boolOrNull(opts.verifyLockers) !== false,
    webhookSecret: secretInvalid ? "" : secret,
    webhookSecretInvalid: secretInvalid,
    pollEnabled: boolOrNull(opts.pollEnabled) !== false,
    pollMaxAgeDays: bounded(opts.pollMaxAgeDays, DEFAULT_POLL_MAX_AGE_DAYS, 1, 365),
    requestsPerMinute: bounded(opts.requestsPerMinute, DEFAULT_REQUESTS_PER_MINUTE, 1, MAX_REQUESTS_PER_MINUTE),
    timeoutMs: bounded(opts.timeoutMs, DEFAULT_TIMEOUT_MS, 3000, 120_000),
    pointsPerMinute: bounded(opts.pointsPerMinute, DEFAULT_POINTS_PER_MINUTE, 1, 6000),
    references: normalizeReferences(opts.references),
    problems,
  }
}

/** Option names live mode still needs, for the admin. Empty in demo mode. */
export function missingOptions(o: ResolvedInpostOptions): string[] {
  if (o.demo) return []
  const missing: string[] = []
  if (!o.apiToken) missing.push("apiToken")
  if (!o.organizationId) missing.push("organizationId")
  return missing
}

/** ShipX can be called: live mode with a token and an organization. */
export function canCallShipx(o: ResolvedInpostOptions): boolean {
  return !o.demo && missingOptions(o).length === 0
}

/** A reference from the template, 3 to 100 characters, with a /n suffix for the second parcel of an order on. */
export function referenceFor(template: string, v: { displayId: number | null; orderId: string; fulfillmentId: string | null; parcelNo?: number }): string {
  const base = template
    .replace(/\{display_id\}/g, v.displayId === null ? v.orderId : String(v.displayId))
    .replace(/\{order_id\}/g, v.orderId)
    .replace(/\{fulfillment_id\}/g, v.fulfillmentId ?? "")
    .replace(/\s+/g, " ")
    .trim()
  const withNo = v.parcelNo && v.parcelNo > 1 ? `${base}/${v.parcelNo}` : base
  const clipped = withNo.slice(0, 100)
  /* ShipX refuses references shorter than 3 characters: "#7" becomes "##7". */
  return clipped.length >= 3 ? clipped : clipped.padStart(3, "#")
}
