/**
 * WHAT THE APIS ACCEPT. Pure, tested with `node --test`.
 *
 * Every request body is read here before anything touches the database:
 * types, lengths, ids, quantities, prices. A body may carry unknown fields
 * (they are ignored), never wrong ones. Errors name the field and a stable
 * code, so a storefront can show its own text:
 *
 *   { field: "target_price", code: "too_many_decimals", message: "..." }
 *
 * Prices are checked twice: the shape here, the amount once the currency of
 * the thread is known (`parsePrice`), because the decimals depend on it.
 */

import { MAX_EXPIRY_DAYS } from "./constants"
import { normalizeCurrency, parseAmount, type AmountError } from "./money"
import { cleanOptionalText, cleanText, optionalId } from "./text"

export interface FieldError {
  field: string
  code: string
  message: string
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] }

export interface Limits {
  maxMessageLength: number
  maxQuantity: number
}

const AMOUNT_MESSAGES: Record<AmountError, string> = {
  required: "A price is required.",
  invalid: "Send the price as a number or a decimal string, like 45.50.",
  not_positive: "The price must be greater than zero.",
  too_many_decimals: "The price has more decimals than the currency allows.",
  too_large: "The price is too large.",
}

function bodyOf(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

function textError(field: string, error: "required" | "too_long" | "invalid", max: number): FieldError {
  if (error === "required") return { field, code: "required", message: `${field} is required.` }
  if (error === "too_long") return { field, code: "too_long", message: `${field} is longer than ${max} characters.` }
  return { field, code: "invalid", message: `${field} must be text.` }
}

/** A price that may be absent: only its shape is checked here (string or number). */
function priceShape(value: unknown, field: string, errors: FieldError[]): unknown | null {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string" && typeof value !== "number") {
    errors.push({ field, code: "invalid", message: AMOUNT_MESSAGES.invalid })
    return null
  }
  return value
}

/** The amount of a price in minor units, once the currency's decimals are known. */
export function parsePrice(raw: unknown, digits: number, field: string): Parsed<number> {
  const r = parseAmount(raw, digits)
  if (r.ok) return { ok: true, value: r.amount }
  return { ok: false, errors: [{ field, code: r.error, message: AMOUNT_MESSAGES[r.error] }] }
}

/** A positive whole quantity up to the limit; 1 when left out. */
export function parseQuantity(value: unknown, max: number): { ok: true; qty: number } | { ok: false; code: "invalid" | "too_large" } {
  if (value === undefined || value === null || value === "") return { ok: true, qty: 1 }
  const n = typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value.trim()) : value
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return { ok: false, code: "invalid" }
  if (n > max) return { ok: false, code: "too_large" }
  return { ok: true, qty: n }
}

/* ------------------------------------------------------------------ */
/* Store API                                                           */
/* ------------------------------------------------------------------ */

export interface OpenInput {
  productId: string | null
  variantId: string | null
  cartId: string | null
  qty: number
  /** The raw target price; parsed once the currency is known. Null: the customer asks for an offer. */
  price: unknown | null
  currencyCode: string | null
  message: string
}

/**
 * POST /store/negotiations
 *
 *   { product_id?, variant_id?, cart_id?, quantity? (or qty), target_price?,
 *     currency_code?, message }
 *
 * A thread is about a product, a variant (with or without its product) or a
 * cart, never a cart and a product at once. A cart thread has no quantity:
 * its price is for the whole cart.
 */
export function parseOpenBody(body: unknown, limits: Limits): Parsed<OpenInput> {
  const b = bodyOf(body)
  const errors: FieldError[] = []
  const product = optionalId(b.product_id)
  const variant = optionalId(b.variant_id)
  const cart = optionalId(b.cart_id)
  if (!product.ok) errors.push({ field: "product_id", code: "invalid", message: "product_id is not a valid id." })
  if (!variant.ok) errors.push({ field: "variant_id", code: "invalid", message: "variant_id is not a valid id." })
  if (!cart.ok) errors.push({ field: "cart_id", code: "invalid", message: "cart_id is not a valid id." })
  const productId = product.ok ? product.id : null
  const variantId = variant.ok ? variant.id : null
  const cartId = cart.ok ? cart.id : null
  if (product.ok && variant.ok && cart.ok) {
    if (!productId && !variantId && !cartId) errors.push({ field: "product_id", code: "required", message: "Send a product_id, a variant_id or a cart_id." })
    if (cartId && (productId || variantId)) errors.push({ field: "cart_id", code: "invalid", message: "A thread is about a cart or a product, not both." })
  }
  const rawQty = b.quantity ?? b.qty
  let qty = 1
  if (cartId && rawQty !== undefined && rawQty !== null && rawQty !== "" && Number(rawQty) !== 1) {
    errors.push({ field: "quantity", code: "invalid", message: "A cart thread has no quantity: the price is for the whole cart." })
  } else {
    const q = parseQuantity(rawQty, limits.maxQuantity)
    if (q.ok) qty = q.qty
    else errors.push({ field: "quantity", code: q.code, message: q.code === "too_large" ? `The quantity is larger than ${limits.maxQuantity}.` : "The quantity must be a whole number from 1." })
  }
  const price = priceShape(b.target_price, "target_price", errors)
  let currencyCode: string | null = null
  if (b.currency_code !== undefined && b.currency_code !== null && b.currency_code !== "") {
    currencyCode = normalizeCurrency(b.currency_code)
    if (!currencyCode) errors.push({ field: "currency_code", code: "invalid", message: "currency_code is a three-letter code, like pln." })
  }
  const message = cleanText(b.message, limits.maxMessageLength)
  if (!message.ok) errors.push(textError("message", message.error, limits.maxMessageLength))
  if (errors.length > 0 || !message.ok) return { ok: false, errors }
  return { ok: true, value: { productId, variantId, cartId, qty, price, currencyCode, message: message.text } }
}

/** POST /store/negotiations/:id/messages: { message, target_price? }. */
export function parseCustomerMessage(body: unknown, limits: Limits): Parsed<{ message: string; price: unknown | null }> {
  const b = bodyOf(body)
  const errors: FieldError[] = []
  const price = priceShape(b.target_price, "target_price", errors)
  const message = cleanText(b.message, limits.maxMessageLength)
  if (!message.ok) errors.push(textError("message", message.error, limits.maxMessageLength))
  if (errors.length > 0 || !message.ok) return { ok: false, errors }
  return { ok: true, value: { message: message.text, price } }
}

/**
 * POST /store/negotiations/:id/accept: { price?, message? }. `price` is the
 * offer the customer saw; when it no longer matches, the accept is refused
 * instead of agreeing to a price the customer never read.
 */
export function parseCustomerAccept(body: unknown, limits: Limits): Parsed<{ price: unknown | null; message: string | null }> {
  const b = bodyOf(body)
  const errors: FieldError[] = []
  const price = priceShape(b.price, "price", errors)
  const message = cleanOptionalText(b.message, limits.maxMessageLength)
  if (!message.ok) errors.push(textError("message", message.error, limits.maxMessageLength))
  if (errors.length > 0 || !message.ok) return { ok: false, errors }
  return { ok: true, value: { price, message: message.text } }
}

/** POST /store/negotiations/:id/decline: { message? }. Also the admin reject body. */
export function parseOptionalMessage(body: unknown, limits: Limits): Parsed<{ message: string | null }> {
  const b = bodyOf(body)
  const message = cleanOptionalText(b.message, limits.maxMessageLength)
  if (!message.ok) return { ok: false, errors: [textError("message", message.error, limits.maxMessageLength)] }
  return { ok: true, value: { message: message.text } }
}

/* ------------------------------------------------------------------ */
/* Admin API                                                           */
/* ------------------------------------------------------------------ */

/** POST /admin/negotiations/threads/:id/messages: { message }. */
export function parseAdminMessage(body: unknown, limits: Limits): Parsed<{ message: string }> {
  const message = cleanText(bodyOf(body).message, limits.maxMessageLength)
  if (!message.ok) return { ok: false, errors: [textError("message", message.error, limits.maxMessageLength)] }
  return { ok: true, value: { message: message.text } }
}

/** POST /admin/negotiations/threads/:id/notes: { note }. */
export function parseNote(body: unknown, limits: Limits): Parsed<{ note: string }> {
  const note = cleanText(bodyOf(body).note, limits.maxMessageLength)
  if (!note.ok) return { ok: false, errors: [textError("note", note.error, limits.maxMessageLength)] }
  return { ok: true, value: { note: note.text } }
}

/** POST /admin/negotiations/threads/:id/counter: { price, message?, valid_days? }. */
export function parseCounter(body: unknown, limits: Limits): Parsed<{ price: unknown; message: string | null; validDays: number | null }> {
  const b = bodyOf(body)
  const errors: FieldError[] = []
  const price = priceShape(b.price, "price", errors)
  if (price === null && errors.length === 0) errors.push({ field: "price", code: "required", message: AMOUNT_MESSAGES.required })
  const message = cleanOptionalText(b.message, limits.maxMessageLength)
  if (!message.ok) errors.push(textError("message", message.error, limits.maxMessageLength))
  let validDays: number | null = null
  if (b.valid_days !== undefined && b.valid_days !== null && b.valid_days !== "") {
    const n = typeof b.valid_days === "string" ? Number(b.valid_days.trim()) : b.valid_days
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_EXPIRY_DAYS) {
      errors.push({ field: "valid_days", code: "invalid", message: `valid_days is a whole number of days from 1 to ${MAX_EXPIRY_DAYS}.` })
    } else validDays = n
  }
  if (errors.length > 0 || !message.ok) return { ok: false, errors }
  return { ok: true, value: { price, message: message.text, validDays } }
}

/** POST /admin/negotiations/threads/:id/accept: { price?, message? }. `price` is the price the person saw. */
export function parseAdminAccept(body: unknown, limits: Limits): Parsed<{ price: unknown | null; message: string | null }> {
  return parseCustomerAccept(body, limits)
}

/* ------------------------------------------------------------------ */
/* Query strings                                                       */
/* ------------------------------------------------------------------ */

export function firstParam(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const s = firstParam(value)
  if (!/^\d+$/.test(s)) return fallback
  return Math.min(max, Math.max(min, Number(s)))
}
