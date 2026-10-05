/**
 * MEDUSA ORDER TO CONTRACT ORDER. Pure: the input is what `query.graph`
 * returns for the fields in `ORDER_FIELDS`, the output is the body of
 * `POST /v1/orders`.
 *
 * PRICES. Every line carries its gross total after discounts and the gross
 * unit price derived from it (`total / quantity`, 4 decimals). That is the
 * price the customer paid, so the ZK shows the same value as the order, and
 * the bridge never has to guess whether a catalog price was tax inclusive.
 *
 * CODES. EAN first (digits only, 8 to 14 of them), then the SKU. The SKU may
 * lose configured suffixes on the way (`-WH` for wholesale variants that
 * share one product in Subiekt, for example).
 */

import type { ContractAddress, ContractLine, ContractOrder } from "./contract"
import type { PaymentState } from "./payment"
import { money, round, toNumber } from "./numbers"

/**
 * Fields `buildOrderPayload` reads, in `query.graph` syntax. Whole relations
 * (`items.*`), not single columns: amounts are BigNumbers stored next to a
 * `raw_` twin, and asking for `items.quantity` alone returns nothing, which
 * also zeroes the computed totals. (`*items` is the HTTP API shorthand; inside
 * Medusa it silently returns items without their columns.)
 */
export const ORDER_FIELDS: readonly string[] = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "created_at",
  "status",
  "metadata",
  "total",
  "subtotal",
  "item_total",
  "shipping_total",
  "discount_total",
  "tax_total",
  "customer.id",
  "customer.first_name",
  "customer.last_name",
  "customer.company_name",
  "customer.phone",
  "shipping_address.*",
  "billing_address.*",
  "items.*",
  "items.tax_lines.*",
  "items.adjustments.*",
  "items.variant.id",
  "items.variant.sku",
  "items.variant.barcode",
  "items.variant.ean",
  "items.variant.upc",
  "shipping_methods.*",
  "shipping_methods.tax_lines.*",
  "shipping_methods.adjustments.*",
  "payment_collections.*",
  "payment_collections.payments.*",
  "payment_collections.payments.captures.*",
]

/* ------------------------------------------------------------------ */
/* Input shape (loose on purpose: Medusa versions differ in details)   */
/* ------------------------------------------------------------------ */

export interface AddressRecord {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  address_1?: string | null
  address_2?: string | null
  postal_code?: string | null
  city?: string | null
  province?: string | null
  country_code?: string | null
  phone?: string | null
  metadata?: Record<string, unknown> | null
}

export interface OrderItemRecord {
  id: string
  title?: string | null
  product_title?: string | null
  variant_title?: string | null
  variant_sku?: string | null
  variant_barcode?: string | null
  quantity?: unknown
  unit_price?: unknown
  total?: unknown
  discount_total?: unknown
  tax_lines?: Array<{ rate?: unknown }> | null
  variant?: { sku?: string | null; barcode?: string | null; ean?: string | null; upc?: string | null } | null
}

export interface ShippingMethodRecord {
  id?: string
  name?: string | null
  shipping_option_id?: string | null
  amount?: unknown
  total?: unknown
  data?: Record<string, unknown> | null
  tax_lines?: Array<{ rate?: unknown }> | null
}

export interface OrderRecord {
  id: string
  display_id?: number | null
  email?: string | null
  currency_code?: string | null
  created_at?: string | Date | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  total?: unknown
  item_total?: unknown
  shipping_total?: unknown
  discount_total?: unknown
  tax_total?: unknown
  customer?: {
    id?: string | null
    first_name?: string | null
    last_name?: string | null
    company_name?: string | null
    phone?: string | null
  } | null
  shipping_address?: AddressRecord | null
  billing_address?: AddressRecord | null
  items?: OrderItemRecord[] | null
  shipping_methods?: ShippingMethodRecord[] | null
}

export interface PayloadOptions {
  stripSkuSuffixes: readonly string[]
  omitLinesWithoutCode: boolean
  forwardMetadataKeys: readonly string[]
  taxIdMetadataKeys: readonly string[]
}

export interface PayloadResult {
  payload: ContractOrder
  /** Lines left out because they have neither EAN nor SKU (`omitLinesWithoutCode`). */
  omitted: Array<{ line_id: string; title: string | null }>
}

export class PayloadError extends Error {
  readonly code: string
  /** Bad order data does not get better by waiting. */
  readonly retryable = false
  constructor(code: string, message: string) {
    super(message)
    this.name = "PayloadError"
    this.code = code
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function text(value: unknown): string | null {
  if (typeof value !== "string") return null
  const t = value.trim()
  return t.length > 0 ? t : null
}

/** Digits only, 8 to 14 of them (EAN-8, UPC-A, EAN-13, GTIN-14). Anything else is not a barcode. */
export function normalizeEan(value: unknown): string | null {
  const t = text(value)
  if (!t) return null
  const digits = t.replace(/[\s-]/g, "")
  return /^\d{8,14}$/.test(digits) ? digits : null
}

/** Trimmed SKU without the configured suffixes (case-insensitive, at the very end only). */
export function normalizeSku(value: unknown, stripSuffixes: readonly string[]): string | null {
  let sku = text(value)
  if (!sku) return null
  for (const suffix of stripSuffixes) {
    const s = suffix.trim()
    if (s && sku.length > s.length && sku.toUpperCase().endsWith(s.toUpperCase())) {
      sku = sku.slice(0, sku.length - s.length).trim()
    }
  }
  return sku.length > 0 ? sku : null
}

function taxRate(lines: Array<{ rate?: unknown }> | null | undefined): number | null {
  if (!lines || lines.length === 0) return null
  return round(lines.reduce((sum, l) => sum + toNumber(l.rate), 0), 2)
}

function address(a: AddressRecord | null | undefined): ContractAddress | null {
  if (!a) return null
  const out: ContractAddress = {
    first_name: text(a.first_name),
    last_name: text(a.last_name),
    company: text(a.company),
    address_1: text(a.address_1),
    address_2: text(a.address_2),
    postal_code: text(a.postal_code),
    city: text(a.city),
    province: text(a.province),
    country_code: text(a.country_code)?.toLowerCase() ?? null,
    phone: text(a.phone),
  }
  return Object.values(out).some((v) => v !== null) ? out : null
}

function iso(value: string | Date | null | undefined): string {
  const d = value instanceof Date ? value : value ? new Date(value) : new Date(NaN)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

const PICKUP_KEYS = ["pickup_point", "target_point", "point_id", "locker_id", "parcel_locker", "paczkomat"]

/** Pickup point from shipping method data (InPost and similar providers), best effort. */
export function pickupPoint(data: Record<string, unknown> | null | undefined): { id: string; name: string | null; address: string | null } | null {
  if (!data || typeof data !== "object") return null
  for (const key of PICKUP_KEYS) {
    const value = data[key]
    if (typeof value === "string" && value.trim()) return { id: value.trim(), name: null, address: null }
    if (value && typeof value === "object") {
      const v = value as Record<string, unknown>
      const id = text(v.id) ?? text(v.name) ?? text(v.code)
      if (id) {
        const addr = v.address
        const addressText =
          typeof addr === "string"
            ? text(addr)
            : addr && typeof addr === "object"
              ? [text((addr as Record<string, unknown>).line1), text((addr as Record<string, unknown>).line2)].filter(Boolean).join(", ") || null
              : null
        return { id, name: text(v.name) ?? text(v.label), address: addressText }
      }
    }
  }
  return null
}

const NOTE_KEYS = ["customer_note", "note", "notes", "comment", "order_note"]

function metadataText(meta: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const v = text(meta[key])
    if (v) return v
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

export function buildOrderPayload(order: OrderRecord, payment: PaymentState, options: PayloadOptions): PayloadResult {
  const meta = (order.metadata ?? {}) as Record<string, unknown>
  const lines: ContractLine[] = []
  const omitted: PayloadResult["omitted"] = []

  for (const item of order.items ?? []) {
    const quantity = Math.round(toNumber(item.quantity))
    if (quantity <= 0) continue
    const sku = normalizeSku(item.variant_sku ?? item.variant?.sku, options.stripSkuSuffixes)
    const ean = normalizeEan(item.variant_barcode) ?? normalizeEan(item.variant?.ean) ?? normalizeEan(item.variant?.barcode) ?? normalizeEan(item.variant?.upc)
    const title = text(item.title) ?? text(item.product_title)
    if (!sku && !ean && options.omitLinesWithoutCode) {
      omitted.push({ line_id: item.id, title })
      continue
    }
    const fallbackTotal = toNumber(item.unit_price) * quantity - toNumber(item.discount_total)
    const total = money(item.total !== undefined && item.total !== null ? item.total : fallbackTotal)
    lines.push({
      line_id: item.id,
      sku,
      ean,
      title,
      product_title: text(item.product_title),
      variant_title: text(item.variant_title),
      quantity,
      unit_price_gross: round(total / quantity, 4),
      total_gross: total,
      discount_gross: money(item.discount_total),
      tax_rate: taxRate(item.tax_lines),
    })
  }

  if (lines.length === 0) {
    throw new PayloadError(
      "no_lines",
      omitted.length > 0
        ? `Order ${order.display_id ?? order.id} has no line with an EAN or SKU, so there is nothing to put on a ZK.`
        : `Order ${order.display_id ?? order.id} has no lines.`,
    )
  }

  const method = (order.shipping_methods ?? [])[0]
  const billing = address(order.billing_address)
  const shippingAddr = address(order.shipping_address)
  const taxId =
    metadataText(meta, options.taxIdMetadataKeys) ??
    metadataText((order.billing_address?.metadata ?? {}) as Record<string, unknown>, options.taxIdMetadataKeys)
  const companyName = billing?.company ?? text(order.customer?.company_name)

  const forwarded: Record<string, unknown> = {}
  for (const key of options.forwardMetadataKeys) {
    if (Object.prototype.hasOwnProperty.call(meta, key)) forwarded[key] = meta[key]
  }

  let note = metadataText(meta, NOTE_KEYS)
  if (omitted.length > 0) {
    const list = omitted.map((o) => o.title ?? o.line_id).join(", ")
    note = [note, `Lines without a product code, not on this ZK: ${list}`].filter(Boolean).join("\n")
  }

  const payload: ContractOrder = {
    order_id: order.id,
    display_id: typeof order.display_id === "number" ? order.display_id : 0,
    currency_code: (text(order.currency_code) ?? "pln").toLowerCase(),
    placed_at: iso(order.created_at),
    email: text(order.email),
    customer: order.customer
      ? {
          id: text(order.customer.id),
          first_name: text(order.customer.first_name),
          last_name: text(order.customer.last_name),
          company_name: text(order.customer.company_name),
          phone: text(order.customer.phone),
        }
      : null,
    billing_address: billing,
    shipping_address: shippingAddr,
    invoice: { requested: Boolean(taxId || companyName), tax_id: taxId, company_name: companyName },
    lines,
    shipping: method
      ? {
          name: text(method.name),
          option_id: text(method.shipping_option_id),
          price_gross: money(method.total !== undefined && method.total !== null ? method.total : method.amount),
          tax_rate: taxRate(method.tax_lines),
          pickup_point: pickupPoint(method.data),
        }
      : null,
    payment: {
      status: payment.status,
      provider_id: payment.providerId,
      method: payment.method,
      amount_paid: payment.amountPaid,
      captured_at: payment.capturedAt,
      due_days: payment.dueDays,
    },
    totals: {
      items_gross: money(order.item_total),
      shipping_gross: money(order.shipping_total),
      discount_gross: money(order.discount_total),
      tax_total: order.tax_total === undefined || order.tax_total === null ? null : money(order.tax_total),
      total_gross: money(order.total),
    },
    note,
    metadata: forwarded,
  }

  return { payload, omitted }
}

/** Payment term in days from order metadata (trade credit), when the storefront records one. */
export function dueDaysFromMetadata(meta: Record<string, unknown> | null | undefined): number | null {
  if (!meta) return null
  for (const key of ["payment_term_days", "payment_due_days", "due_days"]) {
    const n = toNumber(meta[key])
    if (n > 0) return Math.floor(n)
  }
  return null
}
