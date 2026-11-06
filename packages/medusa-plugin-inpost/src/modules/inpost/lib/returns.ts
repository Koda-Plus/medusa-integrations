import { createHash } from "node:crypto"
import { displayName, isEmail, normalizePhone } from "./address"
import { DEMO_RETURN_DAYS } from "./constants"
import type { ProblemDto, ReturnDto, ReturnFilter, ReturnMethod, ReturnPlanDto, ReturnState } from "./contract"
import { iso } from "./dto"
import { referenceFor, type ResolvedInpostOptions } from "./options"
import { canonicalJson, type PlanOrder } from "./plan"
import type { ReturnCreateRequest } from "./returns-client"
import { trackingUrl } from "./statuses"

/**
 * RETURNS, AS PURE FUNCTIONS: the row and how the admin sees it, the plan a
 * person reads before a return is created (and the exact Returns API request
 * it turns into), the simulated returns of demo mode.
 *
 * NO CUSTOMER DATA AT REST. A return row keeps the order, the Medusa return,
 * what InPost answered (the shipment UUID, the tracking number, the short
 * number, the drop-off code, whether a label exists, the expiry) and what the
 * plugin did. The customer's name, e-mail and phone, which InPost needs as
 * the `sender` of the return, are read from the order whenever the plan is
 * built, like the receiver of a shipment.
 *
 * WHERE THE PARCEL GOES: the plugin never sends `recipient` or
 * `destination`; InPost uses the return address of the account, which the
 * InPost Integration Team sets up with the credentials.
 */

type When = Date | string | null | undefined

export interface ReturnRow {
  id: string
  order_id: string
  display_id: number | null
  return_id: string | null
  /** The Medusa return id, or "-" for a return a person created for the order: one row per (order, return_key, demo). */
  return_key: string
  demo: boolean
  state: string
  method: string | null
  reference: string | null
  plan_hash: string | null
  shipment_id: string | null
  inpost_parcel_id: string | null
  tracking_number: string | null
  short_number: string | null
  drop_off_code: string | null
  has_label: boolean
  expires_at: When
  skip_reason: string | null
  error: string | null
  error_code: string | null
  attempts: number
  claim_token: string | null
  claimed_at: When
  lease_until: When
  created_by: string | null
  shipment_created_at: When
  last_checked_at: When
  created_at?: When
  updated_at?: When
  deleted_at?: When
}

/** The key of a row: the Medusa return id, or "-" for a return of the order without one. */
export function returnKey(returnId: string | null | undefined): string {
  const s = String(returnId ?? "").trim()
  return s ? s.slice(0, 100) : "-"
}

const STATES: readonly ReturnState[] = ["pending", "creating", "created", "failed", "unknown", "skipped"]

export function returnStateOf(v: string): ReturnState {
  return (STATES as readonly string[]).includes(v) ? (v as ReturnState) : "pending"
}

export const RETURN_FILTERS: readonly ReturnFilter[] = ["all", "open", "created", "attention", "skipped"]

export function isReturnFilter(v: unknown): v is ReturnFilter {
  return typeof v === "string" && (RETURN_FILTERS as readonly string[]).includes(v)
}

/** The service filters of a returns list, in the current mode. */
export function returnFilters(filter: ReturnFilter, demo: boolean): Record<string, unknown> {
  const where: Record<string, unknown> = { demo }
  if (filter === "open") where.state = ["pending", "creating", "failed", "unknown"]
  else if (filter === "created") where.state = "created"
  else if (filter === "attention") where.state = ["failed", "unknown"]
  else if (filter === "skipped") where.state = "skipped"
  return where
}

export function toReturnDto(row: ReturnRow, now: Date = new Date()): ReturnDto {
  const state = returnStateOf(row.state)
  const created = state === "created"
  const expiresAt = iso(row.expires_at)
  const method: ReturnMethod | null = row.method === "code" || row.method === "label" ? row.method : null
  return {
    id: row.id,
    orderId: row.order_id,
    displayId: row.display_id ?? null,
    returnId: row.return_id ?? null,
    state,
    method,
    reference: row.reference ?? null,
    shipmentId: row.shipment_id ?? null,
    trackingNumber: row.tracking_number ?? null,
    trackingUrl: row.tracking_number && !row.demo ? trackingUrl(row.tracking_number) : null,
    shortNumber: row.short_number ?? null,
    dropOffCode: row.drop_off_code ?? null,
    hasLabel: Boolean(row.has_label),
    expiresAt,
    expired: Boolean(expiresAt && new Date(expiresAt).getTime() < now.getTime()),
    skipReason: row.skip_reason ?? null,
    error: row.error ?? null,
    errorCode: row.error_code ?? null,
    attempts: Number(row.attempts ?? 0),
    createdBy: row.created_by ?? null,
    shipmentCreatedAt: iso(row.shipment_created_at),
    lastCheckedAt: iso(row.last_checked_at),
    demo: Boolean(row.demo),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    actions: {
      create: state === "pending",
      refresh: created && Boolean(row.shipment_id),
      label: created && Boolean(row.has_label) && Boolean(row.tracking_number),
      retry: state === "failed" || state === "unknown",
      skip: state === "pending" || state === "failed" || state === "unknown",
    },
  }
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export type ReturnProblemCode = "return_email_missing" | "return_phone_missing" | "return_not_configured"
export type ReturnWarningCode = "return_sample_contact" | "return_name_missing"

const SAMPLE_EMAIL = "customer@example.com"
const SAMPLE_PHONE = "+48000000000"

/**
 * A phone in E.164, as the Returns API wants it: nine Polish digits become
 * +48 and the digits; a number already written with + and 8 to 15 digits
 * stays; anything else is null.
 */
export function e164Phone(raw: unknown): string | null {
  const pl = normalizePhone(raw)
  if (pl) return `+48${pl}`
  const s = String(raw ?? "").trim()
  if (!s.startsWith("+") && !s.startsWith("00")) return null
  const digits = s.replace(/\D+/g, "").replace(/^00/, "")
  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null
}

/** The expiry of a new return: the end of the day `days` from now (UTC), stable for the whole day, so the plan read in the morning is still the plan at noon. */
export function expirationFor(days: number | null, now: Date): string | null {
  if (!days) return null
  const d = new Date(now.getTime() + days * 24 * 3600 * 1000)
  return `${d.toISOString().slice(0, 10)}T23:59:59Z`
}

export interface ReturnPlan extends ReturnPlanDto {
  request: (ReturnCreateRequest & Record<string, unknown>) | null
}

/**
 * The plan of a return: the customer as the sender, the origin country, the
 * order number for the label, how it is sent and the expiry. Pure: the order
 * comes in as Medusa's Query returns it.
 */
export function buildReturnPlan(
  order: PlanOrder,
  ctx: { options: ResolvedInpostOptions; demo: boolean; configured: boolean; returnId: string | null; method: ReturnMethod; now?: Date },
): ReturnPlan {
  const now = ctx.now ?? new Date()
  const a = order.shipping_address ?? null
  const problems: ProblemDto[] = []
  const warnings: ProblemDto[] = []
  let email = [order.email, order.customer?.email].map((v) => String(v ?? "").trim()).find((v) => isEmail(v)) ?? null
  let phone = e164Phone(a?.phone)
  let sample = false
  if (ctx.demo && !email) {
    email = SAMPLE_EMAIL
    sample = true
  }
  if (ctx.demo && !phone) {
    phone = SAMPLE_PHONE
    sample = true
  }
  if (!email) problems.push({ code: "return_email_missing" })
  if (!phone) problems.push({ code: "return_phone_missing", detail: a?.phone ? String(a.phone).slice(0, 30) : undefined })
  if (!ctx.configured) problems.push({ code: "return_not_configured" })
  if (sample) warnings.push({ code: "return_sample_contact" })
  const first = String(a?.first_name ?? "").trim().slice(0, 60)
  const last = String(a?.last_name ?? "").trim().slice(0, 60)
  const company = String(a?.company ?? "").trim().slice(0, 100)
  if (!company && !(first && last)) warnings.push({ code: "return_name_missing" })
  const country = String(a?.country_code ?? "").trim().toUpperCase()
  const reference = referenceFor(ctx.options.referenceTemplate, { displayId: typeof order.display_id === "number" ? order.display_id : null, orderId: order.id, fulfillmentId: null })
  const expirationDate = expirationFor(ctx.options.returns.expirationDays, now)

  const request: ReturnPlan["request"] =
    problems.length === 0 && email && phone
      ? {
          sender: {
            ...(company ? { companyName: company } : {}),
            ...(first ? { firstName: first } : {}),
            ...(last ? { lastName: last } : {}),
            email,
            phone,
          },
          ...(/^[A-Z]{2}$/.test(country) ? { origin: { countryCode: country } } : {}),
          references: { orderNumber: reference },
          enableDropOffCode: ctx.method === "code",
          ...(expirationDate ? { expirationDate } : {}),
        }
      : null

  return {
    ok: problems.length === 0,
    sender: { name: displayName(a), email, phone, sample },
    originCountry: /^[A-Z]{2}$/.test(country) ? country : null,
    method: ctx.method,
    reference,
    expirationDate,
    destination: "account",
    problems,
    warnings,
    request,
    hash: returnPlanHash({ request, orderId: order.id, returnKey: returnKey(ctx.returnId) }),
  }
}

export function returnPlanHash(parts: { request: unknown; orderId: string; returnKey: string }): string {
  return createHash("sha256").update(canonicalJson({ v: 1, kind: "return", ...parts })).digest("hex").slice(0, 24)
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

function digits(seed: string, n: number): string {
  const hex = createHash("sha256").update(seed).digest("hex")
  let out = ""
  for (let i = 0; out.length < n; i++) out += String(parseInt(hex.charAt(i % hex.length), 16) % 10)
  return out.slice(0, n)
}

/** A simulated return as InPost would answer it: a UUID, a tracking number of 24 digits starting with 6303, a short number, a 9 digit drop-off code (or a label), 14 days to send it. Deterministic. */
export function demoReturnShipment(seed: string, method: ReturnMethod, now: Date): { id: string; parcelId: string; trackingNumber: string; shortNumber: string; dropOffCode: string | null; hasLabel: boolean; expiresAt: Date } {
  const hex = createHash("sha256").update(`ret:${seed}`).digest("hex")
  const uuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
  const short = digits(`short:${seed}`, 7)
  return {
    id: uuid(hex),
    parcelId: uuid(hex.slice(32) + hex.slice(0, 32)),
    trackingNumber: `6303${digits(`tn:${seed}`, 20)}`,
    shortNumber: `${short.slice(0, 4)} ${short.slice(4)}`,
    dropOffCode: method === "code" ? digits(`code:${seed}`, 9) : null,
    hasLabel: method === "label",
    expiresAt: new Date(now.getTime() + DEMO_RETURN_DAYS * 24 * 3600 * 1000),
  }
}
