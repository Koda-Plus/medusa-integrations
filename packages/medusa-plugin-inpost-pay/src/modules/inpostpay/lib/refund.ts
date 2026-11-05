import { createHash } from "node:crypto"

/**
 * REFUNDS THROUGH INPOST PAY ("Ordering a refund" and "List of
 * transactions", space PL, pages 357793884 and 356876498):
 *
 *   POST /v1/izi/transaction/{transaction_id}/refund
 *        header X-Command-ID (a UUID, InPost's idempotency key)
 *        body   external_refund_id, refund_amount (a decimal, 1.23),
 *               additional_business_data, signature
 *   GET  /v1/izi/transaction?order_id=...   the transactions of the store
 *
 * The signature: SHA-512, lowercase hex, of the X-Command-ID, the
 * transaction_id, every body value but `signature` in the alphanumeric order
 * of the field names (a nested object gives its keys and values, a null an
 * empty string) and the merchant secret (merchant.inpost.pl, API keys). Both
 * examples of the page give the hashes it lists (test/refund.test.ts).
 *
 * InPost takes no refunds between 23:00 and 6:30. Pure functions.
 */

export interface RefundBody {
  external_refund_id?: string | null
  refund_amount?: number | null
  additional_business_data?: Record<string, string> | null
}

function flatten(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "object") {
    const o = value as Record<string, unknown>
    return Object.keys(o)
      .sort()
      .map((k) => `${k}${flatten(o[k])}`)
      .join("")
  }
  /* A number is signed as JSON writes it, so the signed text and the sent text agree. */
  return typeof value === "number" ? JSON.stringify(value) : String(value)
}

export function refundSignature(input: { commandId: string; transactionId: string; body: RefundBody; merchantSecret: string }): string {
  const body = input.body as Record<string, unknown>
  const values = Object.keys(body)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => flatten(body[k]))
    .join("")
  return createHash("sha512").update(`${input.commandId}${input.transactionId}${values}${input.merchantSecret}`).digest("hex")
}

/** A UUID derived from a text: the same refund attempt always gets the same X-Command-ID. */
export function uuidFrom(text: string): string {
  const h = createHash("sha256").update(text).digest("hex")
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/**
 * The command id of a refund: the basket, the number of refunds already
 * made and the amount. A refund Medusa retries after an unclear answer gets
 * the same id, so InPost does not pay it twice; the next refund gets a new one.
 */
export function refundCommandId(basketId: string, refundsSoFar: number, amountMinor: number): string {
  return uuidFrom(`inpostpay-refund:${basketId}:${refundsSoFar}:${amountMinor}`)
}

/** Whether InPost takes refunds now: not between 23:00 and 6:30, Polish time. */
export function refundWindowOpen(at: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at)
  const hour = Number(parts.find((p) => p.type === "hour")?.value)
  const minute = Number(parts.find((p) => p.type === "minute")?.value)
  const m = hour * 60 + minute
  return m >= 6 * 60 + 30 && m < 23 * 60
}

export interface InpostTransaction {
  transaction_id: string
  status: string
  amount: number | null
  order_id: string
  created_date: string | null
}

/** Statuses of a transaction that can still be refunded. */
const REFUNDABLE = ["CAPTURED", "PARTIALLY_REFUNDED", "AUTHORIZED"]

/**
 * The transaction to refund for a Medusa order. InPost's `order_id` is "the
 * merchant's order id|InPost's order id"; the merchant's part is the Medusa
 * order id the plugin answered `POST /v1/izi/order` with. A declined attempt
 * before the paid one is skipped; two paid transactions of one order are
 * not guessed between.
 */
export function pickTransaction(items: InpostTransaction[], orderId: string): { ok: true; transaction: InpostTransaction } | { ok: false; reason: "none" | "refunded" | "ambiguous" } {
  const own = items.filter((t) => t.order_id === orderId || t.order_id.startsWith(`${orderId}|`))
  const open = own.filter((t) => REFUNDABLE.includes(t.status))
  if (open.length === 1) return { ok: true, transaction: open[0] }
  if (open.length > 1) {
    const captured = open.filter((t) => t.status !== "AUTHORIZED")
    if (captured.length === 1) return { ok: true, transaction: captured[0] }
    return { ok: false, reason: "ambiguous" }
  }
  return { ok: false, reason: own.some((t) => t.status === "REFUNDED") ? "refunded" : "none" }
}

/** The transaction list item as the plugin reads it; null when it has no id. */
export function toTransaction(raw: unknown): InpostTransaction | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const id = typeof r.transaction_id === "string" ? r.transaction_id : ""
  if (!id) return null
  const amount = Number(r.amount)
  return {
    transaction_id: id,
    status: typeof r.status === "string" ? r.status : "",
    amount: Number.isFinite(amount) ? amount : null,
    order_id: typeof r.order_id === "string" ? r.order_id : "",
    created_date: typeof r.created_date === "string" ? r.created_date : null,
  }
}
