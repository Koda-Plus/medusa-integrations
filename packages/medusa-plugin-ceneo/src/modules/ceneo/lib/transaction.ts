/**
 * ZAUFANE OPINIE: the payload of `_ceneo('transaction', {...})` for the
 * order confirmation page (https://github.com/ceneo/ceneo-integration).
 * Pure, zero runtime imports.
 *
 * - `order_id`: the number the shopper sees (display_id), at most 32 chars.
 * - `shop_products[].id`: the offer id of the feed, so Ceneo matches the
 *   purchase to its offer; `price` per unit, gross, after discounts.
 * - `amount`: the order total as paid.
 * - `client_email` only with the survey consent from the checkout.
 * - Only for 24 hours after the order, never for a canceled one.
 */

export const TRANSACTION_WINDOW_MS = 24 * 60 * 60 * 1000
const ORDER_ID_MAX = 32
const CART_ID = /^cart_[0-9A-Za-z]{10,64}$/

export interface OrderItemLite {
  variant_id?: string | null
  variant_sku?: string | null
  quantity?: unknown
  total?: unknown
}

export interface OrderLite {
  id: string
  display_id?: unknown
  email?: string | null
  currency_code?: string | null
  total?: unknown
  created_at?: string | Date | null
  canceled_at?: string | Date | null
  status?: string | null
  items?: Array<OrderItemLite | null> | null
}

export interface CeneoShopProduct {
  id: string
  price: number
  quantity: number
  currency: string
}

export interface CeneoTransaction {
  client_email?: string
  order_id: string
  shop_products: CeneoShopProduct[]
  work_days_to_send_questionnaire?: number
  amount: number
}

export type TransactionResult = { ok: true; transaction: CeneoTransaction } | { ok: false; code: "order_canceled" | "order_expired" | "order_empty" }

export function isCartId(v: unknown): v is string {
  return typeof v === "string" && CART_ID.test(v)
}

/** A Medusa amount: a number, a numeric string or a BigNumber (`numeric`, `toJSON`). */
export function amountOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (v && typeof v === "object") {
    const o = v as { numeric?: unknown; toJSON?: () => unknown }
    if (typeof o.numeric === "number") return amountOf(o.numeric)
    if (typeof o.toJSON === "function") return amountOf(o.toJSON())
  }
  return null
}

const round2 = (n: number) => Math.round(n * 100) / 100

function time(v: string | Date | null | undefined): number | null {
  if (!v) return null
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isFinite(t) ? t : null
}

export interface TransactionInput {
  order: OrderLite
  /** The feed offer id of a variant item; null leaves the item out (no offer on Ceneo to match). */
  offerIdOf: (item: OrderItemLite) => string | null
  survey: boolean
  workDays: number | null
  now: number
}

export function buildTransaction({ order, offerIdOf, survey, workDays, now }: TransactionInput): TransactionResult {
  if (order.canceled_at || order.status === "canceled") return { ok: false, code: "order_canceled" }
  const created = time(order.created_at)
  if (created === null || now - created > TRANSACTION_WINDOW_MS || created - now > 5 * 60 * 1000) return { ok: false, code: "order_expired" }
  const currency = (order.currency_code ?? "pln").toUpperCase()

  /* One entry per offer; the same variant on two lines is summed. */
  const byId = new Map<string, { total: number; quantity: number }>()
  for (const item of order.items ?? []) {
    if (!item) continue
    const quantity = amountOf(item.quantity)
    const total = amountOf(item.total)
    if (quantity === null || quantity <= 0 || total === null) continue
    const id = offerIdOf(item)
    if (!id) continue
    const cur = byId.get(id) ?? { total: 0, quantity: 0 }
    byId.set(id, { total: cur.total + total, quantity: cur.quantity + quantity })
  }
  if (byId.size === 0) return { ok: false, code: "order_empty" }
  const shop_products = [...byId.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, v]) => ({ id, price: round2(v.total / v.quantity), quantity: v.quantity, currency }))

  const number = order.display_id !== undefined && order.display_id !== null && String(order.display_id).trim() !== "" ? String(order.display_id) : order.id
  const tx: CeneoTransaction = {
    order_id: number.slice(0, ORDER_ID_MAX),
    shop_products,
    amount: round2(amountOf(order.total) ?? shop_products.reduce((a, p) => a + p.price * p.quantity, 0)),
  }
  const email = typeof order.email === "string" ? order.email.trim() : ""
  if (survey && email) tx.client_email = email
  if (workDays !== null) tx.work_days_to_send_questionnaire = workDays
  return { ok: true, transaction: tx }
}

/** `{ cart_id, survey }` from the storefront, or why not. */
export function parseConsent(body: Record<string, unknown>): { ok: true; cartId: string; survey: boolean } | { ok: false; message: string } {
  if (!isCartId(body.cart_id)) return { ok: false, message: "cart_id must be a Medusa cart id (cart_...)." }
  if (typeof body.survey !== "boolean") return { ok: false, message: "survey must be true or false: the shopper's answer to the Zaufane Opinie checkbox." }
  return { ok: true, cartId: body.cart_id, survey: body.survey }
}
