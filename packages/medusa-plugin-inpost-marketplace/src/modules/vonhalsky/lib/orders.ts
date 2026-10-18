/**
 * MARKETPLACE ORDERS INTO MEDUSA ORDERS: the pure parts. Reading an order in
 * the shape of the public SDK's `Order` model (the wire format is camelCase,
 * snake_case is accepted too), deciding whether and how it becomes a Medusa
 * order, and what an existing row means for a second import.
 *
 * NEVER INVENT A PRODUCT: a line whose offer is not one of ours (by the
 * offer id, then the external id, then the SKU) holds the whole order with
 * the reason. A person fixes the offer and retries.
 */

import type { MarketplaceAddress, MarketplaceOrder, MarketplaceOrderLine } from "./client"
import { DEMO_ORDER_MARKER, MARKETPLACE_REF_KEY, marketplaceRef } from "./constants"
import { toMinor } from "./pricing"

type Raw = Record<string, unknown>

const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {})
const text = (v: unknown, max = 300): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v !== "string") return null
  const s = v.trim().slice(0, max)
  return s ? s : null
}
/** The camelCase key of the wire format, or its snake_case twin. */
function pick(o: Raw, camel: string): unknown {
  if (o[camel] !== undefined) return o[camel]
  const snake = camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
  return o[snake]
}

function money(v: unknown): { minor: number | null; currency: string | null } {
  const m = obj(v)
  return { minor: toMinor(m.amount), currency: text(m.currency, 3)?.toUpperCase() ?? null }
}

function address(v: unknown): MarketplaceAddress | null {
  const a = obj(v)
  const out: MarketplaceAddress = {
    street: text(a.street),
    building: text(a.building, 40),
    flat: text(a.flat, 40),
    city: text(a.city, 120),
    postCode: text(pick(a, "postCode"), 20),
    countryCode: text(pick(a, "countryCode"), 2)?.toUpperCase() ?? null,
  }
  return Object.values(out).some(Boolean) ? out : null
}

/**
 * One marketplace order from its JSON. Lenient: missing fields become null,
 * so `planImport` can say exactly what is missing instead of a parse error.
 * The SDK's `OrderLineItem` names no quantity; a `quantity` field is read
 * when present, else every line counts as one item.
 */
export function parseMarketplaceOrder(input: unknown): MarketplaceOrder {
  const o = obj(input)
  const delivery = obj(o.delivery)
  const customer = obj(o.customer)
  const invoiceRaw = o.invoice ? obj(o.invoice) : null
  const payment = obj(pick(o, "paymentDetails"))
  const total = money(pick(o, "finalPrice"))
  const dPrice = money(delivery.price)
  const rawLines = (Array.isArray(pick(o, "orderLines")) ? (pick(o, "orderLines") as unknown[]) : []).map(obj)
  const lines: MarketplaceOrderLine[] = rawLines.map((l) => {
    const offer = obj(l.offer ?? l)
    const product = obj(offer.product)
    const price = money(offer.price)
    const qty = Number(l.quantity ?? offer.quantity ?? 1)
    return {
      offerId: text(pick(offer, "offerId"), 80) ?? "",
      externalId: text(pick(offer, "externalId"), 80),
      sku: text(product.sku, 120),
      ean: text(product.ean, 20),
      name: text(product.name) ?? "",
      quantity: Number.isInteger(qty) && qty > 0 ? qty : 0,
      unitPriceMinor: price.minor ?? 0,
    }
  })
  const typeRaw = text(pick(delivery, "deliveryType"), 20)?.toUpperCase()
  const paymentType = text(pick(payment, "selectedPaymentType"), 40)?.toUpperCase() ?? text(pick(o, "paymentType"), 40)?.toUpperCase() ?? null
  return {
    id: text(o.id, 80) ?? "",
    status: text(o.status, 20)?.toUpperCase() ?? "UNKNOWN",
    createdAt: text(pick(o, "createdAt"), 40),
    currency: total.currency ?? (rawLines.length > 0 ? money(obj(obj(rawLines[0].offer ?? rawLines[0]).price)).currency : null) ?? "PLN",
    totalMinor: total.minor,
    buyer: {
      firstName: text(pick(customer, "firstName"), 120),
      lastName: text(pick(customer, "lastName"), 120),
      email: text(customer.email, 200),
      phone: text(pick(customer, "phoneNumber"), 30),
      address: address(customer.address),
    },
    delivery: {
      type: typeRaw === "APM" || typeRaw === "COURIER" ? typeRaw : "UNKNOWN",
      point: text(pick(delivery, "deliveryPoint"), 40),
      name: text(delivery.name, 120),
      address: address(delivery.address),
      phone: text(pick(delivery, "phoneNumber"), 30),
      priceMinor: dPrice.minor ?? 0,
    },
    invoice: invoiceRaw
      ? {
          companyName: text(pick(invoiceRaw, "companyName"), 200),
          taxId: text(pick(invoiceRaw, "taxId"), 30),
          firstName: text(pick(invoiceRaw, "firstName"), 120),
          lastName: text(pick(invoiceRaw, "lastName"), 120),
          address: address(invoiceRaw.address),
        }
      : null,
    lines,
    paymentType,
    paid: paymentType !== "CASH_ON_DELIVERY",
    comment: text(o.comment, 500),
  }
}

/* ------------------------------------------------------------------ */
/* The decision                                                        */
/* ------------------------------------------------------------------ */

export interface OfferRef {
  remoteId: string | null
  variantId: string
  sku: string | null
  title: string | null
}

export interface ImportContext {
  regionId: string | null
  currency: string | null
  salesChannelId: string | null
  /** The shipping option for this order's delivery type (`shippingOptionFor`). */
  shippingOptionId: string | null
  offers: readonly OfferRef[]
  demo: boolean
}

export interface MedusaAddressInput {
  first_name?: string
  last_name?: string
  company?: string
  address_1?: string
  address_2?: string
  city?: string
  postal_code?: string
  country_code?: string
  phone?: string
}

export interface MedusaOrderInput {
  region_id: string
  sales_channel_id: string
  currency_code: string
  status: "draft"
  is_draft_order: true
  no_notification: true
  shipping_address: MedusaAddressInput
  billing_address: MedusaAddressInput
  items: Array<{
    variant_id: string
    title: string
    quantity: number
    unit_price: number
    is_tax_inclusive: true
    is_discountable: false
    requires_shipping: true
    metadata: Record<string, unknown>
  }>
  shipping_methods: Array<{ name: string; amount: number; is_tax_inclusive: true; shipping_option_id?: string; data: Record<string, unknown> }>
  metadata: Record<string, unknown>
}

export type HoldCode = "no_id" | "no_lines" | "bad_line" | "unmapped_lines" | "currency_mismatch" | "no_region" | "no_channel" | "no_address" | "cancelled"

export type ImportDecision =
  | { kind: "create"; order: MedusaOrderInput; email: string | null; paid: boolean; lines: Array<{ offer_id: string; variant_id: string; sku: string | null; title: string; quantity: number; unit_price_minor: number }> }
  | { kind: "hold"; code: HoldCode; reason: string }

function clean<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== "") out[k] = v
  return out as T
}

const major = (minor: number): number => Math.round(minor) / 100

function streetLine(a: MarketplaceAddress): string | null {
  const number = [a.building, a.flat].filter(Boolean).join("/")
  return [a.street, number].filter(Boolean).join(" ") || null
}

function medusaAddress(a: MarketplaceAddress, person: { firstName: string | null; lastName: string | null; phone: string | null }, extra?: { company?: string | null; address2?: string | null }): MedusaAddressInput {
  return clean({
    first_name: person.firstName ?? undefined,
    last_name: person.lastName ?? undefined,
    company: extra?.company ?? undefined,
    address_1: streetLine(a) ?? undefined,
    address_2: extra?.address2 ?? undefined,
    city: a.city ?? undefined,
    postal_code: a.postCode ?? undefined,
    country_code: a.countryCode?.toLowerCase() ?? undefined,
    phone: person.phone ?? undefined,
  })
}

/** Which of our offers a line is: the offer id first, then the external id (our variant id), then the SKU. */
export function matchLine(line: MarketplaceOrderLine, offers: readonly OfferRef[]): OfferRef | null {
  return (
    offers.find((o) => o.remoteId && o.remoteId === line.offerId) ??
    (line.externalId ? offers.find((o) => o.variantId === line.externalId) : undefined) ??
    (line.sku ? offers.find((o) => o.sku && o.sku.toUpperCase() === line.sku!.toUpperCase()) : undefined) ??
    null
  )
}

export function planImport(order: MarketplaceOrder, ctx: ImportContext): ImportDecision {
  if (!order.id) return { kind: "hold", code: "no_id", reason: "The marketplace order has no id." }
  if (order.status === "CANCELED" || order.status === "REFUSED" || order.status === "REJECTED") {
    return { kind: "hold", code: "cancelled", reason: `The marketplace order is ${order.status}: it is not imported.` }
  }
  if (order.lines.length === 0) return { kind: "hold", code: "no_lines", reason: "The marketplace order has no lines." }
  if (!ctx.regionId || !ctx.currency) return { kind: "hold", code: "no_region", reason: "No PLN region for marketplace orders: create one or pick it in Settings." }
  if (!ctx.salesChannelId) return { kind: "hold", code: "no_channel", reason: "No sales channel for marketplace orders: pick one in Settings." }
  if (order.currency.toUpperCase() !== ctx.currency.toUpperCase()) {
    return { kind: "hold", code: "currency_mismatch", reason: `The order is in ${order.currency} and the region in ${ctx.currency.toUpperCase()}.` }
  }

  const unmapped: string[] = []
  const lines: Array<{ ref: OfferRef; line: MarketplaceOrderLine }> = []
  for (const l of order.lines) {
    if (l.quantity <= 0 || l.unitPriceMinor <= 0) return { kind: "hold", code: "bad_line", reason: `Line of offer ${l.offerId || "(no id)"} has no quantity or no price.` }
    const ref = matchLine(l, ctx.offers)
    if (!ref) unmapped.push(`offer ${l.offerId || "(no id)"}${l.sku ? ` (SKU ${l.sku})` : ""}`)
    else lines.push({ ref, line: l })
  }
  if (unmapped.length > 0) {
    return { kind: "hold", code: "unmapped_lines", reason: `No Medusa variant for ${unmapped.join("; ")}. No product is ever invented: link the offer and retry.` }
  }

  const ship = order.delivery.address ?? order.buyer.address
  if (!ship || !ship.city || !ship.postCode || !ship.countryCode) {
    return { kind: "hold", code: "no_address", reason: "The order has no complete address (city, post code, country)." }
  }
  const person = { firstName: order.buyer.firstName, lastName: order.buyer.lastName, phone: order.delivery.phone ?? order.buyer.phone }
  /* A parcel locker is not a company: its id goes to the second address line, where a label needs it. */
  const lockerLine = order.delivery.type === "APM" && order.delivery.point ? `Paczkomat ${order.delivery.point}` : null
  const shipping_address = medusaAddress(ship, person, { address2: lockerLine })
  const inv = order.invoice
  const billing_address =
    inv?.address && inv.address.city
      ? medusaAddress(inv.address, { firstName: inv.firstName ?? person.firstName, lastName: inv.lastName ?? person.lastName, phone: person.phone }, { company: inv.companyName })
      : medusaAddress(order.buyer.address ?? ship, person)

  const medusa: MedusaOrderInput = {
    region_id: ctx.regionId,
    sales_channel_id: ctx.salesChannelId,
    currency_code: ctx.currency.toLowerCase(),
    status: "draft",
    is_draft_order: true,
    /* The marketplace talks to its buyer: Medusa sends nothing for this order. */
    no_notification: true,
    shipping_address,
    billing_address,
    items: lines.map(({ ref, line }) => ({
      variant_id: ref.variantId,
      title: ref.title ?? line.name,
      quantity: line.quantity,
      unit_price: major(line.unitPriceMinor),
      is_tax_inclusive: true,
      /* The marketplace price is final: store promotions must not move it. */
      is_discountable: false,
      requires_shipping: true,
      metadata: clean({ vonhalsky_offer_id: line.offerId }),
    })),
    shipping_methods: [
      {
        name: order.delivery.type === "APM" ? `InPost Von Halsky: Paczkomat${order.delivery.point ? ` ${order.delivery.point}` : ""}` : "InPost Von Halsky: courier",
        amount: major(order.delivery.priceMinor),
        is_tax_inclusive: true,
        ...(ctx.shippingOptionId ? { shipping_option_id: ctx.shippingOptionId } : {}),
        data: clean({ vonhalsky_delivery_type: order.delivery.type, vonhalsky_delivery_point: order.delivery.point }),
      },
    ],
    metadata: clean({
      [MARKETPLACE_REF_KEY]: marketplaceRef(order.id),
      vonhalsky_order_id: order.id,
      vonhalsky_payment_type: order.paymentType,
      vonhalsky_delivery_point: order.delivery.point,
      nip: inv?.taxId ?? null,
      [DEMO_ORDER_MARKER]: ctx.demo || null,
    }),
  }
  return {
    kind: "create",
    order: medusa,
    email: order.buyer.email,
    paid: order.paid,
    lines: lines.map(({ ref, line }) => ({ offer_id: line.offerId, variant_id: ref.variantId, sku: ref.sku, title: ref.title ?? line.name, quantity: line.quantity, unit_price_minor: line.unitPriceMinor })),
  }
}

/* ------------------------------------------------------------------ */
/* Idempotency                                                         */
/* ------------------------------------------------------------------ */

export type ImportAction =
  /** No row yet: write it, then create the order. */
  | { kind: "create" }
  /** The Medusa order exists: nothing is created again. */
  | { kind: "already"; orderId: string }
  /** A draft from an earlier attempt exists: finish it, never create a second one. */
  | { kind: "finish"; orderId: string }
  /** Held or failed before the order existed: try again. */
  | { kind: "retry" }
  /** Another process is importing it right now. */
  | { kind: "busy" }

/** How long an `importing` row counts as somebody's live attempt. */
export const IMPORT_LEASE_MS = 5 * 60 * 1000

export function importAction(row: { status: string; order_id: string | null; updated_at?: Date | string | null } | null, now: Date = new Date()): ImportAction {
  if (!row) return { kind: "create" }
  if (row.status === "imported" && row.order_id) return { kind: "already", orderId: row.order_id }
  if (row.order_id) return { kind: "finish", orderId: row.order_id }
  if (row.status === "importing") {
    const at = row.updated_at ? new Date(row.updated_at).getTime() : 0
    if (Number.isFinite(at) && now.getTime() - at < IMPORT_LEASE_MS) return { kind: "busy" }
  }
  return { kind: "retry" }
}
