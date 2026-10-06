/**
 * FROM MEDUSA RECORDS TO TEMPLATE DATA. Pure functions over what Query
 * returns, zero Medusa imports, so the tests feed them plain objects.
 *
 * Who gets no e-mail (`orderSkipReason`):
 *   - an order with `no_notification` (Medusa's own flag, also set by the
 *     Koda Plus Allegro and BaseLinker imports);
 *   - an order carrying a key of `skipOrderMetadataKeys` in its metadata
 *     (`marketplace_order_ref` by default: the marketplace already wrote to
 *     the buyer);
 *   - an order without an e-mail address.
 * A shipment with `no_notification` in its event is skipped by the
 * subscriber; a customer without an account (a guest) gets no welcome.
 */

import type { EmailLocale } from "./constants"
import { cleanText, safeUrl } from "./html"
import { metadataLocale, normalizeLocale, pickLocale, toNumber } from "./locale"
import { buildLink, type ResolvedEmailsOptions } from "./options"
import { isEmail } from "./security"
import { sampleOrder } from "./templates/samples"
import type { CartEmailData, CanceledEmailData, EmailItem, NegotiationEmailData, OrderEmailData, PasswordResetEmailData, ShipmentEmailData, WelcomeEmailData } from "./types"

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
}

export interface LineItemRecord {
  id?: string | null
  title?: string | null
  product_title?: string | null
  variant_title?: string | null
  variant_sku?: string | null
  quantity?: unknown
  unit_price?: unknown
  total?: unknown
}

export interface CustomerRecord {
  id?: string | null
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  has_account?: boolean | null
  created_at?: string | Date | null
  metadata?: Record<string, unknown> | null
}

export interface FulfillmentRecord {
  id: string
  shipped_at?: string | Date | null
  canceled_at?: string | Date | null
  created_at?: string | Date | null
  provider_id?: string | null
  labels?: Array<{ tracking_number?: string | null; tracking_url?: string | null; label_url?: string | null } | null> | null
  items?: Array<{ title?: string | null; sku?: string | null; quantity?: unknown; line_item_id?: string | null } | null> | null
}

export interface OrderRecord {
  id: string
  display_id?: number | string | null
  custom_display_id?: string | null
  email?: string | null
  currency_code?: string | null
  created_at?: string | Date | null
  canceled_at?: string | Date | null
  locale?: string | null
  metadata?: Record<string, unknown> | null
  customer_id?: string | null
  no_notification?: boolean | null
  total?: unknown
  item_total?: unknown
  shipping_total?: unknown
  discount_total?: unknown
  tax_total?: unknown
  items?: LineItemRecord[] | null
  shipping_address?: AddressRecord | null
  shipping_methods?: Array<{ name?: string | null } | null> | null
  customer?: CustomerRecord | null
  fulfillments?: FulfillmentRecord[] | null
}

export interface CartRecord {
  id: string
  email?: string | null
  currency_code?: string | null
  locale?: string | null
  metadata?: Record<string, unknown> | null
  customer_id?: string | null
  completed_at?: string | Date | null
  updated_at?: string | Date | null
  item_total?: unknown
  total?: unknown
  items?: LineItemRecord[] | null
  shipping_address?: AddressRecord | null
  customer?: CustomerRecord | null
}

/**
 * The data of the `negotiation.*` events, as `@koda-plus/medusa-plugin-negotiations`
 * sends it: `price` is a decimal string in major units ("469.00"),
 * `price_amount` the same in minor units, and a cart thread (`subject: "cart"`)
 * prices the whole cart. Every field is optional: other emitters may send less.
 */
export interface NegotiationEvent {
  id?: string | null
  ref?: string | null
  status?: string | null
  subject?: string | null
  customer_id?: string | null
  product_id?: string | null
  variant_id?: string | null
  cart_id?: string | null
  sku?: string | null
  qty?: unknown
  price?: unknown
  price_amount?: unknown
  currency_code?: string | null
  expires_at?: string | null
  /** Who moved: "customer", "admin" or "system". */
  actor?: string | null
  demo?: boolean | null
}

function iso(v: unknown): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

const DEFAULT_VARIANTS = new Set(["default variant", "default", "domyślny", "domyślny wariant", "standard"])

/** A line item as a template line: the product, the variant when it says more, the SKU, quantity and amounts. */
export function lineItem(it: LineItemRecord): EmailItem | null {
  const title = cleanText(it.product_title || it.title, 160)
  if (!title) return null
  const variant = cleanText(it.variant_title, 80)
  const useVariant = variant && !DEFAULT_VARIANTS.has(variant.toLowerCase()) && variant.toLowerCase() !== title.toLowerCase()
  const quantity = toNumber(it.quantity) ?? 1
  const unit = toNumber(it.unit_price)
  const total = toNumber(it.total)
  return {
    title,
    variant: useVariant ? variant : null,
    sku: cleanText(it.variant_sku, 60) || null,
    quantity,
    unit_price: unit,
    total: total ?? (unit !== null ? Math.round(unit * quantity * 100) / 100 : null),
  }
}

export function addressLines(a: AddressRecord | null | undefined): string[] {
  if (!a) return []
  const person = [a.first_name, a.last_name].map((x) => cleanText(x, 60)).filter(Boolean).join(" ")
  const company = cleanText(a.company, 100)
  return [
    company || person,
    company && person ? person : "",
    [a.address_1, a.address_2].map((x) => cleanText(x, 120)).filter(Boolean).join(", "),
    [cleanText(a.postal_code, 20), cleanText(a.city, 80)].filter(Boolean).join(" "),
  ].filter(Boolean)
}

/** Why an order gets no e-mail, or null when it does. */
export function orderSkipReason(order: Pick<OrderRecord, "email" | "no_notification" | "metadata">, o: Pick<ResolvedEmailsOptions, "skipOrderMetadataKeys">): "no_notification" | "marketplace" | "no_email" | null {
  if (order.no_notification === true) return "no_notification"
  const meta = order.metadata && typeof order.metadata === "object" ? order.metadata : {}
  if (o.skipOrderMetadataKeys.some((k) => meta[k] !== undefined && meta[k] !== null && meta[k] !== "" && meta[k] !== false)) return "marketplace"
  if (!isEmail(String(order.email ?? "").trim())) return "no_email"
  return null
}

/**
 * The tag a message is written in: the record's own tag when it names the
 * language picked (en-US keeps US formats), otherwise the language code.
 */
function localeTag(candidates: readonly unknown[], fallback: EmailLocale): string {
  const lang = pickLocale(candidates, fallback)
  for (const c of candidates) {
    if (typeof c === "string" && normalizeLocale(c) === lang && /^[a-z]{2}[-_][A-Za-z]{2}$/i.test(c.trim())) return c.trim()
  }
  return lang
}

export function orderLocale(order: Pick<OrderRecord, "locale" | "metadata" | "customer">, o: Pick<ResolvedEmailsOptions, "defaultLocale">): string {
  return localeTag([order.locale, metadataLocale(order.metadata), metadataLocale(order.customer?.metadata)], o.defaultLocale)
}

export function orderData(order: OrderRecord, o: Pick<ResolvedEmailsOptions, "defaultLocale">): OrderEmailData {
  const items = (Array.isArray(order.items) ? order.items : []).map(lineItem).filter((i): i is EmailItem => i !== null)
  const custom = cleanText(order.custom_display_id, 40)
  const display = order.display_id === null || order.display_id === undefined ? "" : cleanText(order.display_id, 40)
  const a = order.shipping_address
  return {
    locale: orderLocale(order, o),
    order_id: order.id,
    order_number: custom || display || null,
    order_date: iso(order.created_at),
    currency_code: cleanText(order.currency_code, 3).toLowerCase() || null,
    customer_name: cleanText(a?.first_name, 60) || cleanText(order.customer?.first_name, 60) || null,
    company_name: cleanText(a?.company, 100) || cleanText(order.customer?.company_name, 100) || null,
    items,
    items_total: toNumber(order.item_total),
    shipping_total: toNumber(order.shipping_total),
    discount_total: toNumber(order.discount_total),
    tax_total: toNumber(order.tax_total),
    total: toNumber(order.total),
    shipping_method: cleanText(order.shipping_methods?.find((m) => m?.name)?.name, 120) || null,
    shipping_address: addressLines(a),
    country_code: cleanText(a?.country_code, 2).toLowerCase() || null,
  }
}

export function canceledData(order: OrderRecord, o: Pick<ResolvedEmailsOptions, "defaultLocale">): CanceledEmailData {
  return { ...orderData(order, o), canceled_at: iso(order.canceled_at) ?? new Date().toISOString() }
}

/** A tracking link: the label's own, or the `trackingUrls` template of the fulfillment provider. */
export function trackingUrl(number: string, labelUrl: unknown, providerId: string | null | undefined, o: Pick<ResolvedEmailsOptions, "trackingUrls">): string | null {
  const own = safeUrl(labelUrl)
  if (own) return own
  if (!providerId) return null
  const template = o.trackingUrls[providerId] ?? o.trackingUrls[providerId.split("_")[0]] ?? null
  return template ? safeUrl(template.replace("{number}", encodeURIComponent(number))) : null
}

function sumQuantity(list: ReadonlyArray<{ quantity?: unknown } | null> | null | undefined): number {
  return (list ?? []).reduce((s, i) => s + (toNumber(i?.quantity) ?? 0), 0)
}

export function shipmentData(order: OrderRecord, f: FulfillmentRecord, o: Pick<ResolvedEmailsOptions, "defaultLocale" | "trackingUrls">): ShipmentEmailData {
  const base = orderData(order, o)
  const byLine = new Map((order.items ?? []).filter((i) => i?.id).map((i) => [String(i.id), i]))
  const shipped: EmailItem[] = []
  for (const fi of f.items ?? []) {
    if (!fi) continue
    const line = fi.line_item_id ? byLine.get(fi.line_item_id) : undefined
    const item = line ? lineItem({ ...line, quantity: fi.quantity }) : lineItem({ title: fi.title, variant_sku: fi.sku, quantity: fi.quantity })
    if (item) shipped.push({ ...item, unit_price: null, total: null })
  }
  const tracking = (f.labels ?? [])
    .filter((l): l is NonNullable<typeof l> => Boolean(l && cleanText(l.tracking_number, 80)))
    .map((l) => {
      const number = cleanText(l.tracking_number, 80)
      return { number, url: trackingUrl(number, l.tracking_url, f.provider_id, o), carrier: null }
    })
  const ordered = sumQuantity(order.items)
  const others = (order.fulfillments ?? []).filter((x) => x && x.id !== f.id && !x.canceled_at && x.shipped_at)
  const shippedSoFar = sumQuantity(f.items) + others.reduce((s, x) => s + sumQuantity(x.items), 0)
  return {
    ...base,
    shipped_at: iso(f.shipped_at) ?? iso(f.created_at) ?? new Date().toISOString(),
    partial: ordered > 0 && shippedSoFar > 0 && shippedSoFar < ordered,
    tracking,
    shipped_items: shipped,
  }
}

export function welcomeData(c: CustomerRecord, o: Pick<ResolvedEmailsOptions, "defaultLocale">): WelcomeEmailData {
  return {
    locale: localeTag([metadataLocale(c.metadata)], o.defaultLocale),
    customer_name: cleanText(c.first_name, 60) || null,
    company_name: cleanText(c.company_name, 100) || null,
    customer_since: iso(c.created_at) ?? new Date().toISOString(),
  }
}

/** Why a customer gets no welcome, or null. */
export function welcomeSkipReason(c: CustomerRecord | null): "not_found" | "guest" | "no_email" | null {
  if (!c) return "not_found"
  if (c.has_account !== true) return "guest"
  if (!isEmail(String(c.email ?? "").trim())) return "no_email"
  return null
}

/**
 * A password reset: the address, the link with the token and where it
 * leads (the storefront for customers, the admin for users). Null when the
 * link cannot be built (no storefrontUrl or links.passwordReset, an actor
 * type without a page).
 */
export function resetData(
  input: { email: string; actorType: string; token: string; metadata?: Record<string, unknown> | null; person?: CustomerRecord | null },
  o: Pick<ResolvedEmailsOptions, "defaultLocale" | "links" | "passwordResetMinutes">,
  adminLinkTemplate: string | null,
): PasswordResetEmailData | null {
  if (!isEmail(input.email) || !input.token) return null
  const actor = input.actorType === "customer" ? "customer" : input.actorType === "user" ? "user" : null
  if (!actor) return null
  const template = actor === "customer" ? o.links.passwordReset : adminLinkTemplate
  const url = buildLink(template, { token: input.token, email: input.email })
  if (!url) return null
  return {
    locale: localeTag([metadataLocale(input.metadata), metadataLocale(input.person?.metadata)], o.defaultLocale),
    email: input.email,
    reset_url: url,
    actor,
    customer_name: cleanText(input.person?.first_name, 60) || null,
    expires_minutes: o.passwordResetMinutes,
  }
}

export function cartData(cart: CartRecord, o: Pick<ResolvedEmailsOptions, "defaultLocale">): CartEmailData {
  const items = (Array.isArray(cart.items) ? cart.items : []).map(lineItem).filter((i): i is EmailItem => i !== null)
  return {
    locale: localeTag([cart.locale, metadataLocale(cart.metadata), metadataLocale(cart.customer?.metadata)], o.defaultLocale),
    cart_id: cart.id,
    currency_code: cleanText(cart.currency_code, 3).toLowerCase() || null,
    customer_name: cleanText(cart.shipping_address?.first_name, 60) || cleanText(cart.customer?.first_name, 60) || null,
    items,
    cart_total: toNumber(cart.item_total) ?? toNumber(cart.total),
    country_code: cleanText(cart.shipping_address?.country_code, 2).toLowerCase() || null,
  }
}

/** Decimals of a currency through Intl: 2 for PLN, 0 for JPY; 2 when unknown. */
export function currencyDigits(code: string | null | undefined): number {
  try {
    const d = new Intl.NumberFormat("en", { style: "currency", currency: String(code ?? "").toUpperCase() }).resolvedOptions().maximumFractionDigits
    return typeof d === "number" && d >= 0 && d <= 4 ? d : 2
  } catch {
    return 2
  }
}

/**
 * The price of a negotiation event in major units: `price_amount` (minor
 * units, exact) when the event has it, else a `price` string (a decimal in
 * major units, as the negotiation plugin sends it), else a numeric `price`
 * read as `negotiationAmounts` says.
 */
export function negotiationPrice(e: Pick<NegotiationEvent, "price" | "price_amount">, currency: string | null, amounts: "minor" | "major"): number | null {
  const digits = currencyDigits(currency)
  const minor = e.price_amount
  if (typeof minor === "number" && Number.isSafeInteger(minor) && minor >= 0) return minor / 10 ** digits
  if (typeof e.price === "string") {
    const major = toNumber(e.price.trim())
    return major !== null && major >= 0 ? major : null
  }
  const raw = toNumber(e.price)
  if (raw === null || raw < 0) return null
  return amounts === "minor" ? raw / 10 ** digits : raw
}

/** A negotiation event with the customer and the product read by the subscriber. */
export function negotiationData(
  e: NegotiationEvent,
  extra: { customer?: CustomerRecord | null; productTitle?: string | null; variantTitle?: string | null; sku?: string | null },
  o: Pick<ResolvedEmailsOptions, "defaultLocale" | "negotiationAmounts">,
): NegotiationEmailData {
  const currency = cleanText(e.currency_code, 3).toLowerCase() || null
  const subject = e.subject === "cart" || e.subject === "product" || e.subject === "variant" ? e.subject : null
  return {
    locale: localeTag([metadataLocale(extra.customer?.metadata)], o.defaultLocale),
    negotiation_id: cleanText(e.id, 80) || null,
    ref: cleanText(e.ref, 40) || null,
    status: cleanText(e.status, 30) || null,
    subject,
    customer_name: cleanText(extra.customer?.first_name, 60) || null,
    product_title: cleanText(extra.productTitle, 160) || null,
    variant_title: extra.variantTitle && !DEFAULT_VARIANTS.has(extra.variantTitle.toLowerCase()) ? cleanText(extra.variantTitle, 80) : null,
    sku: cleanText(extra.sku, 60) || cleanText(e.sku, 60) || null,
    quantity: subject === "cart" ? null : toNumber(e.qty),
    price: negotiationPrice(e, currency, o.negotiationAmounts),
    currency_code: currency,
    expires_at: iso(e.expires_at),
  }
}

/**
 * The store's real data for a preview or a test send, with the person
 * replaced by the sample one: the products, amounts, numbers and dates stay,
 * the name, the company and the address do not. A test e-mail to any
 * address never carries a customer's details.
 */
export function anonymize<T extends { customer_name?: string | null; company_name?: string | null; shipping_address?: string[] | null }>(data: T, locale: EmailLocale): T {
  const sample = sampleOrder(locale)
  return {
    ...data,
    ...("customer_name" in data ? { customer_name: sample.customer_name } : {}),
    ...("company_name" in data ? { company_name: sample.company_name } : {}),
    ...("shipping_address" in data ? { shipping_address: sample.shipping_address } : {}),
  }
}
