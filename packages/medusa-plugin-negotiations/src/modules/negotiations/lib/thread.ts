/**
 * ONE THREAD, READ ONCE. Pure, tested with `node --test`.
 *
 * `normalizeThread` turns a database row into the values every other part
 * works with: the status, the currency and its decimals, the amounts (from
 * the new columns, or from the old single price of an app-module row), what
 * the thread is about, whose move it is, when it expires. The admin DTOs, the
 * Store API DTOs, the event payloads and the draft order writer all start
 * from this, so they can never disagree about a price.
 */

import { DEMO_ID_PREFIX, isStatus, type NegotiationStatus, type Subject, type ThreadSource, type WaitingFor } from "./constants"
import { effectiveExpiry } from "./expiry"
import { isLegacyPriced, legacyAmounts } from "./legacy"
import { currencyDigits, multiply, normalizeCurrency, percentBelow } from "./money"
import type { CartLine, ThreadRow } from "./rows"
import { inferWaitingFor, isActive } from "./status"

export interface Thread {
  id: string
  ref: string
  status: NegotiationStatus
  demo: boolean
  source: ThreadSource
  /** One of the generated threads of the demo story. */
  demoStory: boolean
  subject: Subject | null
  customerId: string | null
  productId: string | null
  variantId: string | null
  cartId: string | null
  orderId: string | null
  sku: string | null
  /** The product (and variant) title when the thread was opened. */
  title: string | null
  qty: number
  /** The thread currency, or the default currency for an old row without one. */
  currencyCode: string | null
  /** The currency was not stored on the row (an app-module row). */
  currencyAssumed: boolean
  digits: number
  /** Unit prices for a product or variant, the whole cart for a cart; minor units. */
  requested: number | null
  offered: number | null
  agreed: number | null
  /** The price on the table: the latest proposal or offer, the agreed price once accepted. */
  price: number | null
  /** The catalog price when the thread was opened (the cart's value for a cart). */
  list: number | null
  /** What the price is worth: quantity times the unit price, or the cart price. */
  value: number | null
  /** Percent below the list price, one decimal. */
  discountPercent: number | null
  items: CartLine[] | null
  waitingFor: WaitingFor | null
  lastActivityAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** A validity set by a counter offer (stored). */
  validUntil: Date | null
  /** When the thread expires under the current options, or null. */
  expiresAt: Date | null
  closedAt: Date | null
  closedBy: string | null
  assignedTo: string | null
  messageCount: number
  metadata: Record<string, unknown> | null
  /** The amounts come from the app module's single price and are not stored yet. */
  legacy: boolean
}

export interface NormalizeContext {
  /** The store's default currency, for rows that name none. */
  defaultCurrency: string | null
  expiryDays: number
}

export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isFinite(d.getTime()) ? d : null
}

function int(v: unknown): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    const n = Number(v)
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

function subjectOf(row: ThreadRow): Subject | null {
  if (row.subject === "product" || row.subject === "variant" || row.subject === "cart") return row.subject
  if (row.variant_id) return "variant"
  if (row.product_id) return "product"
  if (row.cart_id) return "cart"
  return null
}

/** Cart lines from the jsonb snapshot; anything malformed is dropped. */
export function cartLines(value: unknown): CartLine[] | null {
  if (!Array.isArray(value)) return null
  const out: CartLine[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue
    const l = raw as Record<string, unknown>
    const quantity = int(l.quantity)
    if (quantity === null || quantity <= 0) continue
    out.push({
      variant_id: typeof l.variant_id === "string" ? l.variant_id : null,
      product_id: typeof l.product_id === "string" ? l.product_id : null,
      sku: typeof l.sku === "string" ? l.sku : null,
      title: typeof l.title === "string" ? l.title : "",
      quantity,
      unit_amount: int(l.unit_amount),
    })
  }
  return out
}

export function normalizeThread(row: ThreadRow, ctx: NormalizeContext): Thread {
  const status: NegotiationStatus = isStatus(row.status) ? row.status : "open"
  const stored = normalizeCurrency(row.currency_code)
  const currencyCode = stored ?? ctx.defaultCurrency
  const digits = currencyDigits(currencyCode)
  const legacy = isLegacyPriced(row)
  const amounts = legacy
    ? legacyAmounts(status, row.target_price, digits)
    : {
        requested: int(row.requested_amount),
        offered: int(row.offered_amount),
        agreed: int(row.agreed_amount),
        price: int(row.price_amount),
      }
  const subject = subjectOf(row)
  const qty = Math.max(1, int(row.qty) ?? 1)
  const price = amounts.price ?? amounts.agreed ?? amounts.offered ?? amounts.requested
  const list = int(row.list_amount)
  const value = price === null ? null : subject === "cart" ? price : multiply(price, qty)
  const lastActivityAt = toDate(row.last_activity_at) ?? toDate(row.updated_at) ?? toDate(row.created_at)
  const validUntil = toDate(row.expires_at)
  const waiting = row.waiting_for === "team" || row.waiting_for === "customer" ? row.waiting_for : null
  return {
    id: row.id,
    ref: row.ref,
    status,
    demo: row.demo === true,
    source: row.source === "demo" ? "demo" : "store",
    demoStory: row.id.startsWith(DEMO_ID_PREFIX),
    subject,
    customerId: row.customer_id ?? null,
    productId: row.product_id ?? null,
    variantId: row.variant_id ?? null,
    cartId: row.cart_id ?? null,
    orderId: row.order_id ?? null,
    sku: row.sku ?? null,
    title: row.title ?? null,
    qty,
    currencyCode,
    currencyAssumed: !stored,
    digits,
    requested: amounts.requested,
    offered: amounts.offered,
    agreed: amounts.agreed,
    price,
    list,
    value,
    discountPercent: percentBelow(list, price),
    items: cartLines(row.items),
    waitingFor: isActive(status) ? (waiting ?? inferWaitingFor(status, null)) : null,
    lastActivityAt,
    createdAt: toDate(row.created_at) ?? new Date(0),
    updatedAt: toDate(row.updated_at) ?? toDate(row.created_at) ?? new Date(0),
    validUntil,
    /* Demo threads keep their story: only an offer's own validity shows, the clock never runs. */
    expiresAt: effectiveExpiry({ status, expiresAt: validUntil, lastActivityAt }, row.demo === true ? 0 : ctx.expiryDays),
    closedAt: isActive(status) ? null : (toDate(row.closed_at) ?? toDate(row.updated_at)),
    closedBy: row.closed_by ?? null,
    assignedTo: row.assigned_to ?? null,
    messageCount: Math.max(0, int(row.message_count) ?? 0),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : null,
    legacy,
  }
}
