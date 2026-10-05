/**
 * RETURNS FROM BASELINKER, READ ONLY: `getOrderReturns` answers into rows
 * without personal data. Pure; imports only other pure files of this folder.
 *
 * BaseLinker sends the buyer's e-mail, phone, login, return address and bank
 * account (number, IBAN, SWIFT) with every return, plus a free-text comment.
 * None of it is needed to show a return next to its order, so the parser
 * keeps an explicit list of fields and everything else is dropped before
 * anything is stored: ids, source, status, dates, the refunded amount and,
 * per product, name, SKU, quantity, price and the reason name.
 */

import { round, toNumberOrNull } from "./numbers"

export interface ReturnProduct {
  name: string
  sku: string | null
  quantity: number
  price: number | null
  reason: string | null
}

export interface ReturnRecord {
  blReturnId: string
  blOrderId: string | null
  source: string | null
  externalReturnId: string | null
  statusId: number | null
  /** 0 active, 5 accepted, 1 done, 2 canceled. */
  fulfillmentStatus: number | null
  /** Refunded amount in minor units. */
  refundedMinor: number | null
  currency: string | null
  products: ReturnProduct[]
  createdAt: Date | null
  statusChangedAt: Date | null
}

/** Fields of a BaseLinker return that are personal data and never stored. */
export const RETURN_FIELDS_DROPPED: readonly string[] = [
  "email",
  "phone",
  "user_login",
  "delivery_fullname",
  "delivery_company",
  "delivery_address",
  "delivery_postcode",
  "delivery_city",
  "delivery_state",
  "delivery_country",
  "delivery_country_code",
  "order_return_account_number",
  "order_return_iban",
  "order_return_swift",
  "refund_account_number",
  "refund_iban",
  "refund_swift",
  "custom_extra_fields",
  "return_reason_comment",
]

function text(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v !== "string") return null
  const t = v.trim()
  return t ? t : null
}

function idText(v: unknown): string | null {
  const t = text(v)
  return t && /^\d+$/.test(t) && Number(t) > 0 ? String(Number(t)) : null
}

function unixDate(v: unknown): Date | null {
  const n = toNumberOrNull(v)
  return n !== null && n > 0 ? new Date(n * 1000) : null
}

export function parseReturns(raw: readonly Record<string, unknown>[], reasons: ReadonlyMap<number, string>): ReturnRecord[] {
  const out: ReturnRecord[] = []
  for (const r of raw) {
    const blReturnId = idText(r.return_id)
    if (!blReturnId) continue
    const products = (Array.isArray(r.products) ? r.products : r.products && typeof r.products === "object" ? Object.values(r.products as Record<string, unknown>) : [])
      .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
      .map((p) => {
        const reasonId = toNumberOrNull(p.return_reason_id)
        const price = toNumberOrNull(p.price_brutto)
        return {
          name: (text(p.name) ?? "").slice(0, 200),
          sku: text(p.sku),
          quantity: Math.max(0, Math.round(toNumberOrNull(p.quantity) ?? 0)),
          price: price === null ? null : round(price, 2),
          reason: reasonId !== null ? reasons.get(reasonId) ?? null : null,
        }
      })
    const refunded = toNumberOrNull(r.refunded)
    out.push({
      blReturnId,
      blOrderId: idText(r.order_id),
      source: text(r.order_return_source)?.toLowerCase() ?? null,
      externalReturnId: text(r.external_order_id),
      statusId: toNumberOrNull(r.status_id),
      fulfillmentStatus: toNumberOrNull(r.fulfillment_status),
      refundedMinor: refunded === null ? null : Math.round(refunded * 100),
      currency: text(r.currency)?.toUpperCase() ?? null,
      products,
      createdAt: unixDate(r.date_add),
      statusChangedAt: unixDate(r.date_in_status),
    })
  }
  return out
}
