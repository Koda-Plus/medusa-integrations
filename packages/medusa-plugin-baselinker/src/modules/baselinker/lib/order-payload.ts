/**
 * MEDUSA ORDER TO `addOrder` PARAMETERS. Pure: the input is what `query.graph`
 * returns for `ORDER_FIELDS`, the output is the body BaseLinker receives.
 * Ported from the production integration (its `_ladunek-faktury.ts` and the
 * order step), generalized: no account constants, no store-specific keys.
 *
 * THE PAYLOAD IS NEVER STORED. It carries the buyer's name, address, phone
 * and tax id, so the outbox keeps only the order id and builds the payload
 * from the order at send time.
 *
 * LINES. A line whose variant is LINKED to a BaseLinker card goes as a catalog
 * line (`storage: "db"`, `storage_id` = the catalog, `product_id` = the card),
 * which is what real orders of a BaseLinker account carry, so stock moves on
 * the right card. Any other line goes as a free line with name, SKU and EAN,
 * and the order still arrives: a missing link must never lose an order.
 *
 * PRICES. `price_brutto` is the price of ONE unit: the line total after
 * discounts divided by the quantity, so `price_brutto * quantity` equals what
 * the customer paid (`addOrder` has no field for a line discount). The tax
 * rate is the highest rate of the line's tax lines.
 *
 * QUANTITY COMES FROM `items.detail.quantity`. Measured in production on
 * Medusa 2.17: without the `detail` relation the graph returns no quantity
 * and every total collapses to zero, without a single error. A line without
 * a readable quantity stops the payload instead of sending one unit for 0.00.
 *
 * PAYMENT. `paid` is 1 only when the payment is captured in full: the value
 * 1 RECORDS A FULL PAYMENT in BaseLinker, and a mistake in that direction
 * ships goods nobody paid for. `payment_method_cod` marks cash on delivery
 * (the courier collects the money), by payment provider prefix. The value
 * types (`paid` as 0 or 1, the COD flag as a boolean, `want_invoice` as the
 * string "1") are what production sends.
 *
 * FIELD LENGTHS follow the `addOrder` documentation (`payment_method` and
 * `delivery_method` have 30 characters, `admin_comments` 200...). A clipped
 * text is better than a refused order.
 */

import { NOTE_METADATA_KEYS, TAX_ID_METADATA_KEYS } from "./constants"
import { normalizeEan } from "./matching"
import { money, round, toNumber, toNumberOrNull } from "./numbers"

/**
 * Fields the payload reads, in `query.graph` syntax. Whole relations
 * (`items.*`, `items.detail.*`), not single columns: amounts are BigNumbers
 * stored next to a `raw_` twin and the totals need the `detail` relation.
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
  "item_total",
  "shipping_total",
  "discount_total",
  "tax_total",
  "customer.phone",
  "shipping_address.*",
  "billing_address.*",
  "items.*",
  "items.detail.*",
  "items.tax_lines.*",
  "items.variant.id",
  "items.variant.sku",
  "items.variant.barcode",
  "items.variant.ean",
  "items.variant.upc",
  "shipping_methods.*",
  "shipping_methods.tax_lines.*",
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
  variant_id?: string | null
  variant_sku?: string | null
  variant_barcode?: string | null
  quantity?: unknown
  detail?: { quantity?: unknown; fulfilled_quantity?: unknown } | null
  unit_price?: unknown
  total?: unknown
  discount_total?: unknown
  tax_lines?: Array<{ rate?: unknown }> | null
  variant?: { id?: string | null; sku?: string | null; barcode?: string | null; ean?: string | null; upc?: string | null } | null
}

export interface ShippingMethodRecord {
  name?: string | null
  amount?: unknown
  total?: unknown
  data?: Record<string, unknown> | null
}

export interface PaymentRecord {
  provider_id?: string | null
  amount?: unknown
  captured_at?: string | Date | null
  canceled_at?: string | Date | null
  captures?: Array<{ amount?: unknown }> | null
}

export interface PaymentCollectionRecord {
  status?: string | null
  payments?: PaymentRecord[] | null
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
  shipping_total?: unknown
  discount_total?: unknown
  customer?: { phone?: string | null } | null
  shipping_address?: AddressRecord | null
  billing_address?: AddressRecord | null
  items?: OrderItemRecord[] | null
  shipping_methods?: ShippingMethodRecord[] | null
  payment_collections?: PaymentCollectionRecord[] | null
}

/* ------------------------------------------------------------------ */
/* Output shape                                                        */
/* ------------------------------------------------------------------ */

export interface AddOrderProduct {
  storage?: "db"
  storage_id?: number
  product_id?: string
  name: string
  sku?: string
  ean?: string
  price_brutto: number
  tax_rate: number
  quantity: number
}

export interface AddOrderPayload {
  order_status_id: number
  custom_source_id?: number
  date_add: number
  currency: string
  email?: string
  phone?: string
  user_comments?: string
  admin_comments: string
  payment_method?: string
  payment_method_cod: boolean
  paid: 0 | 1
  delivery_method?: string
  delivery_price: number
  delivery_fullname?: string
  delivery_company?: string
  delivery_address?: string
  delivery_postcode?: string
  delivery_city?: string
  delivery_state?: string
  delivery_country_code?: string
  delivery_point_id?: string
  delivery_point_name?: string
  delivery_point_address?: string
  delivery_point_postcode?: string
  delivery_point_city?: string
  want_invoice?: "1"
  invoice_fullname?: string
  invoice_company?: string
  invoice_nip?: string
  invoice_address?: string
  invoice_postcode?: string
  invoice_city?: string
  invoice_state?: string
  invoice_country_code?: string
  products: AddOrderProduct[]
}

export interface PayloadOptions {
  orderStatusId: number
  customSourceId: number | null
  /** The catalog of linked lines. Without it every line goes as a free line. */
  inventoryId: number | null
  codProviders: readonly string[]
  /** Custom payment names by provider id prefix, longest prefix first. */
  paymentLabels?: ReadonlyArray<readonly [string, string]>
}

export interface PayloadResult {
  payload: AddOrderPayload
  marker: string
  linked: number
  /** SKUs (or titles) of lines that went as free lines. */
  unlinked: string[]
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

/**
 * THE IDEMPOTENCY KEY. `addOrder` has no field for an external id, so the
 * marker goes to `admin_comments`, first, and the outbox finds an order it
 * already created by scanning `getOrders` for it. The closing bracket keeps
 * one order id from being a prefix of another.
 */
export function orderMarker(orderId: string): string {
  return `[medusa:${orderId}]`
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const t = value.trim()
  return t.length > 0 ? t : undefined
}

/** Clipped text, or undefined. Never an empty string: an empty field reads like lost data. */
function clip(value: unknown, max: number): string | undefined {
  const t = text(value)
  return t ? t.slice(0, max) : undefined
}

function joinText(parts: Array<string | null | undefined>, separator = " "): string | undefined {
  return text(parts.filter((p) => typeof p === "string" && p.trim()).join(separator))
}

function metaText(meta: Record<string, unknown> | null | undefined, keys: readonly string[]): string | undefined {
  if (!meta) return undefined
  for (const key of keys) {
    const v = text(meta[key])
    if (v) return v
  }
  return undefined
}

function country(value: unknown): string | undefined {
  const t = text(value)
  return t ? t.toUpperCase().slice(0, 2) : undefined
}

function highestRate(lines: Array<{ rate?: unknown }> | null | undefined): number {
  const rates = (lines ?? []).map((l) => toNumber(l?.rate)).filter((n) => Number.isFinite(n))
  return rates.length > 0 ? round(Math.max(...rates), 2) : 0
}

export function matchesPrefix(providerId: string | null | undefined, prefixes: readonly string[]): boolean {
  if (!providerId) return false
  const id = providerId.toLowerCase()
  return prefixes.some((p) => {
    const prefix = p.trim().toLowerCase()
    return prefix.length > 0 && id.startsWith(prefix)
  })
}

const LABELS: Array<[RegExp, string]> = [
  [/^pp_stripe-blik/, "BLIK (Stripe)"],
  [/^pp_stripe-przelewy24/, "Przelewy24 (Stripe)"],
  [/^pp_stripe/, "Card (Stripe)"],
  [/^pp_(p24|przelewy24)/, "Przelewy24"],
  [/^pp_payu/, "PayU"],
  [/^pp_tpay/, "Tpay"],
  [/^pp_paypal/, "PayPal"],
  [/^pp_adyen/, "Adyen"],
  [/^pp_mollie/, "Mollie"],
  [/^pp_(cod|cash)/, "Cash on delivery"],
  [/^pp_system_default/, "Manual payment"],
]

/** Short payment label for BaseLinker (30 characters). Unknown providers keep their id. */
export function paymentLabel(
  providerId: string | null | undefined,
  cod: boolean,
  custom: ReadonlyArray<readonly [string, string]> = [],
): string | undefined {
  const id = (providerId ?? "").toLowerCase()
  for (const [prefix, label] of custom) if (id.startsWith(prefix)) return label
  if (!providerId) return cod ? "Cash on delivery" : undefined
  for (const [re, label] of LABELS) if (re.test(id)) return label
  return cod ? "Cash on delivery" : providerId.slice(0, 30)
}

export interface PaymentFacts {
  providerId: string | null
  /** Captured in full: the only case in which `paid` is 1. */
  captured: boolean
  cod: boolean
  amountCaptured: number
}

/** The payment of an order as BaseLinker should see it. The newest live payment names the provider. */
export function paymentFacts(collections: readonly PaymentCollectionRecord[], totalGross: number, codProviders: readonly string[]): PaymentFacts {
  const payments = collections
    .filter((c) => (c?.status ?? "") !== "canceled")
    .flatMap((c) => c?.payments ?? [])
    .filter((p) => p && !p.canceled_at)
  let amountCaptured = 0
  for (const p of payments) {
    const captures = p.captures ?? []
    amountCaptured += captures.length > 0 ? captures.reduce((sum, c) => sum + money(c?.amount), 0) : p.captured_at ? money(p.amount) : 0
  }
  amountCaptured = money(amountCaptured)
  const providerId = payments.length > 0 ? payments[payments.length - 1].provider_id ?? null : null
  const total = money(totalGross)
  return {
    providerId,
    captured: total > 0 && amountCaptured > 0 && amountCaptured + 0.005 >= total,
    cod: matchesPrefix(providerId, codProviders),
    amountCaptured,
  }
}

const PICKUP_KEYS = ["pickup_point", "target_point", "point_id", "locker_id", "parcel_locker", "paczkomat"]

export interface PickupPoint {
  id: string
  name?: string
  address?: string
  postcode?: string
  city?: string
}

/** Pickup point from shipping method data (InPost lockers and similar providers), best effort. */
export function pickupPoint(data: Record<string, unknown> | null | undefined): PickupPoint | null {
  if (!data || typeof data !== "object") return null
  for (const key of PICKUP_KEYS) {
    const value = data[key]
    const direct = text(value)
    if (direct) return { id: direct }
    if (!value || typeof value !== "object") continue
    const v = value as Record<string, unknown>
    const id = text(v.id) ?? text(v.name) ?? text(v.code)
    if (!id) continue
    const point: PickupPoint = { id, name: text(v.name) ?? text(v.label) }
    const addr = v.address
    if (typeof addr === "string") point.address = text(addr)
    else if (addr && typeof addr === "object") {
      const a = addr as Record<string, unknown>
      point.address = text(a.line1) ?? text(a.street)
      point.postcode = text(a.post_code) ?? text(a.postcode) ?? text(a.postal_code)
      point.city = text(a.city)
      const line2 = text(a.line2)
      const m = line2 ? /^(\d{2}-\d{3})\s+(.+)$/.exec(line2) : null
      if (m) {
        point.postcode = point.postcode ?? m[1]
        point.city = point.city ?? m[2]
      }
    }
    return point
  }
  return null
}

function lineQuantity(item: OrderItemRecord): number {
  const raw = item.detail?.quantity ?? item.quantity
  const n = toNumberOrNull(raw)
  if (n === null) {
    throw new PayloadError(
      "no_quantity",
      `Line ${item.id} has no readable quantity (items.detail.quantity). The order for BaseLinker would be false, so it is not built.`,
    )
  }
  return Math.round(n)
}

/* ------------------------------------------------------------------ */
/* Builder                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param links Variant id to BaseLinker card id, for the order's variants.
 */
export function buildAddOrderPayload(order: OrderRecord, links: ReadonlyMap<string, string>, options: PayloadOptions): PayloadResult {
  const meta = (order.metadata ?? {}) as Record<string, unknown>
  const products: AddOrderProduct[] = []
  const unlinked: string[] = []
  let linked = 0

  for (const item of order.items ?? []) {
    const quantity = lineQuantity(item)
    /* Lines edited down to zero stay on the order with quantity 0: skip them. */
    if (quantity <= 0) continue
    const sku = clip(text(item.variant_sku) ?? item.variant?.sku, 50)
    const ean =
      normalizeEan(item.variant_barcode) ?? normalizeEan(item.variant?.ean) ?? normalizeEan(item.variant?.barcode) ?? normalizeEan(item.variant?.upc)
    const fallbackTotal = toNumber(item.unit_price) * quantity - toNumber(item.discount_total)
    const total = money(item.total !== undefined && item.total !== null ? item.total : fallbackTotal)
    const variantId = item.variant_id ?? item.variant?.id ?? null
    const card = variantId && options.inventoryId !== null ? links.get(variantId) : undefined
    const line: AddOrderProduct = {
      name: clip(item.title, 200) ?? clip(item.product_title, 200) ?? sku ?? "Item",
      sku,
      ean: ean ?? undefined,
      price_brutto: round(total / quantity, 2),
      tax_rate: highestRate(item.tax_lines),
      quantity,
    }
    if (card) {
      products.push({ storage: "db", storage_id: options.inventoryId as number, product_id: card, ...line })
      linked += 1
    } else {
      products.push(line)
      unlinked.push(sku ?? line.name)
    }
  }

  if (products.length === 0) {
    throw new PayloadError("no_lines", `Order ${order.display_id ?? order.id} has no lines to send.`)
  }

  const marker = orderMarker(order.id)
  const currency = (text(order.currency_code) ?? "pln").toUpperCase().slice(0, 3)
  const discount = money(order.discount_total)
  const adminComments = (
    joinText(
      [
        marker,
        typeof order.display_id === "number" ? `Medusa #${order.display_id}` : undefined,
        discount > 0 ? `discount ${discount.toFixed(2)} ${currency}` : undefined,
        unlinked.length > 0 ? `not in the BaseLinker catalog: ${unlinked.join(", ")}` : undefined,
      ],
      " | ",
    ) ?? marker
  ).slice(0, 200)

  const created = order.created_at ? new Date(order.created_at).getTime() : NaN
  const dateAdd = Math.floor((Number.isFinite(created) ? created : Date.now()) / 1000)

  const shipping = order.shipping_address ?? null
  const billing = order.billing_address ?? null
  const method = (order.shipping_methods ?? [])[0]
  const shippingTotal =
    order.shipping_total !== undefined && order.shipping_total !== null
      ? money(order.shipping_total)
      : money((order.shipping_methods ?? []).reduce((sum, m) => sum + toNumber(m.total ?? m.amount), 0))

  const payment = paymentFacts(order.payment_collections ?? [], money(order.total), options.codProviders)
  const point = pickupPoint(method?.data)

  const payload: AddOrderPayload = {
    order_status_id: options.orderStatusId,
    ...(options.customSourceId !== null ? { custom_source_id: options.customSourceId } : {}),
    date_add: dateAdd,
    currency,
    email: clip(order.email, 150),
    phone: clip(shipping?.phone, 100) ?? clip(billing?.phone, 100) ?? clip(order.customer?.phone, 100),
    user_comments: clip(metaText(meta, NOTE_METADATA_KEYS), 510),
    admin_comments: adminComments,
    payment_method: paymentLabel(payment.providerId, payment.cod, options.paymentLabels)?.slice(0, 30),
    /* Money already captured is never collected a second time by the courier. */
    payment_method_cod: payment.cod && !payment.captured,
    paid: payment.captured ? 1 : 0,
    delivery_method: clip(method?.name, 30),
    delivery_price: shippingTotal,
    delivery_fullname: clip(joinText([shipping?.first_name, shipping?.last_name]), 100),
    delivery_company: clip(shipping?.company, 100),
    delivery_address: clip(joinText([shipping?.address_1, shipping?.address_2]), 156),
    delivery_postcode: clip(shipping?.postal_code, 10),
    delivery_city: clip(shipping?.city, 100),
    delivery_state: clip(shipping?.province, 20),
    delivery_country_code: country(shipping?.country_code),
    delivery_point_id: clip(point?.id, 40),
    delivery_point_name: clip(point?.name, 100),
    delivery_point_address: clip(point?.address, 100),
    delivery_point_postcode: clip(point?.postcode, 10),
    delivery_point_city: clip(point?.city, 100),
    products,
  }

  /* Invoice: the buyer's decision (`metadata.invoice`) or a tax id. Without
   * one of them no invoice field is sent at all. */
  const taxId = metaText(meta, TAX_ID_METADATA_KEYS) ?? metaText(billing?.metadata ?? null, TAX_ID_METADATA_KEYS)
  const wantsInvoice = meta.invoice === true || meta.invoice === "true" || Boolean(taxId)
  if (wantsInvoice) {
    payload.want_invoice = "1"
    payload.invoice_nip = clip(taxId, 100)
    payload.invoice_company = clip(meta.invoice_company, 200) ?? clip(billing?.company, 200)
    payload.invoice_fullname = clip(joinText([billing?.first_name, billing?.last_name]), 200)
    payload.invoice_address = clip(joinText([billing?.address_1, billing?.address_2]), 250)
    payload.invoice_postcode = clip(billing?.postal_code, 20)
    payload.invoice_city = clip(billing?.city, 100)
    payload.invoice_state = clip(billing?.province, 20)
    payload.invoice_country_code = country(billing?.country_code)
  }

  return { payload, marker, linked, unlinked }
}

/** `order.metadata[key] === true` (or the string "true") keeps an order away from BaseLinker. */
export function isSkipped(metadata: Record<string, unknown> | null | undefined, key: string): boolean {
  if (!metadata || !key) return false
  const v = metadata[key]
  return v === true || v === "true"
}
