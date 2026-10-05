/**
 * WHICH DOCUMENT, AND WHAT GOES IN IT. Pure: the order as `query.graph`
 * returns it for `ORDER_FIELDS`, the options and today's date in; the
 * `invoice` object for `POST /invoices.json` and a summary for the outbox row
 * out. THE PAYLOAD IS NEVER STORED: it carries the buyer's name and address.
 *
 * KINDS
 *   documentFlow "vat"                at the trigger: the final document
 *   documentFlow "proforma_then_vat"  at the trigger: a proforma; after the
 *                                     first fulfillment: the final document
 *   final document                    a company buyer: "vat"; a person: a
 *                                     receipt with `receiptForConsumers`,
 *                                     otherwise "vat"
 *
 * WHEN (`dueKinds`): every event of an order (placed, payment captured,
 * fulfillment created) asks the same question, so the order of events does
 * not matter and a missed event is caught by the next one. The trigger is
 * met when the order is placed (`trigger: "order_placed"`) or captured in
 * full (`trigger: "payment_captured"`). In the proforma flow a fulfilled order
 * gets its final document, and no proforma any more once it is fulfilled.
 *
 * PAYMENT. Captured in full: `paid` = the gross total, no payment term.
 * Otherwise: unpaid with `paymentTermDays`. The payment type comes from the
 * payment provider: cash on delivery providers give "cash_on_delivery" (a
 * documented `payment_type` key, filterable in Fakturownia), `paymentTypes`
 * maps the rest by provider id prefix, anything else is "transfer".
 *
 * `oid` is the Medusa display id (with `oidPrefix`), and `oid_unique: "yes"`
 * makes Fakturownia itself refuse a second document with that number. It is
 * left out only for a final document created from a proforma, which carries
 * the proforma's number.
 */

import { addDays } from "./dates"
import { mapBuyer, type BuyerSource, type BuyerType, type BuyerWarning } from "./buyer"
import { COD_PAYMENT_TYPE, DEFAULT_PAYMENT_TYPE } from "./constants"
import { amountText, money, toNumberOrNull } from "./numbers"
import { departmentFor, type DocumentFlow, type IssueTrigger, type ResolvedFakturowniaOptions } from "./options"
import { buildPositions, type Position, type PositionsSource } from "./positions"

export type DocumentKind = "vat" | "proforma" | "receipt" | "correction"
export type FinalKind = "vat" | "receipt"

/**
 * Fields the document reads, in `query.graph` syntax. Whole relations
 * (`items.*`, `items.detail.*`), not single columns: amounts are BigNumbers
 * and the quantity lives in the `detail` relation.
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
  "shipping_address.*",
  "billing_address.*",
  "items.*",
  "items.detail.*",
  "items.tax_lines.*",
  "items.variant.sku",
  "items.variant.title",
  "shipping_methods.*",
  "shipping_methods.tax_lines.*",
  "payment_collections.*",
  "payment_collections.payments.*",
  "payment_collections.payments.captures.*",
  "fulfillments.id",
  "fulfillments.canceled_at",
  /* 0.2.0: the customer (storefront access, a company module), the sales channel (its department),
     the version (what changed since issue) and the refunds (corrections). */
  "customer_id",
  "sales_channel_id",
  "version",
  "canceled_at",
  "payment_collections.payments.refunds.*",
]

/* ------------------------------------------------------------------ */
/* Input shapes (loose on purpose: Medusa versions differ in details)  */
/* ------------------------------------------------------------------ */

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

export interface OrderRecord extends BuyerSource, PositionsSource {
  id: string
  display_id?: number | null
  created_at?: string | Date | null
  status?: string | null
  total?: unknown
  payment_collections?: PaymentCollectionRecord[] | null
  fulfillments?: Array<{ id?: string; canceled_at?: string | Date | null }> | null
  customer_id?: string | null
  sales_channel_id?: string | null
  /** Medusa's order version: grows with every confirmed change (an edit, a return). */
  version?: number | null
}

/* ------------------------------------------------------------------ */
/* Kinds                                                               */
/* ------------------------------------------------------------------ */

export function finalKind(o: Pick<ResolvedFakturowniaOptions, "receiptForConsumers">, buyerType: BuyerType): FinalKind {
  return buyerType === "person" && o.receiptForConsumers ? "receipt" : "vat"
}

/** The `kind` Fakturownia receives: a receipt leaves as `receiptKind`. */
export function apiKind(kind: DocumentKind, receiptKind: string): string {
  return kind === "receipt" ? receiptKind : kind
}

export interface DueState {
  flow: DocumentFlow
  trigger: IssueTrigger
  canceled: boolean
  capturedInFull: boolean
  fulfilled: boolean
  /** A proforma row already exists for the order (any state but canceled). */
  hasProforma: boolean
  finalKind: FinalKind
}

/** Kinds that are due for an order now. `[]` when nothing is. Idempotent: enqueueing twice is a no-op. */
export function dueKinds(s: DueState): DocumentKind[] {
  if (s.canceled) return []
  const triggerMet = s.trigger === "order_placed" || s.capturedInFull
  if (s.flow === "vat") return triggerMet ? [s.finalKind] : []
  if (s.fulfilled && (triggerMet || s.hasProforma)) return [s.finalKind]
  return triggerMet && !s.fulfilled ? ["proforma"] : []
}

/** What a person gets with "Issue now": the document of the trigger, without waiting for the trigger. */
export function manualKind(s: Pick<DueState, "flow" | "fulfilled" | "finalKind">): DocumentKind {
  if (s.flow === "proforma_then_vat" && !s.fulfilled) return "proforma"
  return s.finalKind
}

/* ------------------------------------------------------------------ */
/* Payment                                                             */
/* ------------------------------------------------------------------ */

export function matchesPrefix(providerId: string | null | undefined, prefixes: readonly string[]): boolean {
  if (!providerId) return false
  const id = providerId.toLowerCase()
  return prefixes.some((p) => {
    const prefix = p.trim().toLowerCase()
    return prefix.length > 0 && id.startsWith(prefix)
  })
}

export interface PaymentFacts {
  providerId: string | null
  /** Captured in full: the document is paid. */
  captured: boolean
  cod: boolean
  amountCaptured: number
}

/** The payment of an order as the document should see it. The newest live payment names the provider. */
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

/** The Fakturownia `payment_type` of a provider. */
export function paymentTypeFor(providerId: string | null, cod: boolean, paymentTypes: ReadonlyArray<readonly [string, string]>): string {
  if (cod) return COD_PAYMENT_TYPE
  const id = (providerId ?? "").toLowerCase()
  if (id) for (const [prefix, type] of paymentTypes) if (id.startsWith(prefix)) return type
  return DEFAULT_PAYMENT_TYPE
}

/** The order number Fakturownia stores as `oid` (and prints as the order number). */
export function orderOid(displayId: number | string | null | undefined, prefix: string): string | null {
  const id = String(displayId ?? "").trim()
  return id ? `${prefix}${id}` : null
}

export function isFulfilled(order: Pick<OrderRecord, "fulfillments">): boolean {
  return (order.fulfillments ?? []).some((f) => f && !f.canceled_at)
}

/* ------------------------------------------------------------------ */
/* The document                                                        */
/* ------------------------------------------------------------------ */

/** What the outbox stores about a document: no buyer data. */
export interface StoredPosition {
  name: string
  code: string | null
  quantity: number
  unit: string
  gross: number
  tax: string
  /** A correction's position: the state before and after (quantity and gross carry the change). */
  before?: { quantity: number; gross: number }
  after?: { quantity: number; gross: number }
}

export interface DocumentSummary {
  kind: DocumentKind
  apiKind: string
  oid: string | null
  issueDate: string
  currency: string
  totalGross: number
  positions: StoredPosition[]
  buyerType: BuyerType
  paid: boolean
  paymentType: string
  fromInvoiceId: string | null
  /** Why a buyer that looks like a company got a consumer document (an invalid or missing NIP). */
  buyerWarning: BuyerWarning | null
  /** The order version the document was built from; null when it was copied from a proforma. */
  orderVersion: number | null
}

export interface BuiltDocument {
  invoice: Record<string, unknown>
  summary: DocumentSummary
}

/** A position of either source: built from the order, or copied from a proforma. */
export interface PositionLike {
  name: string
  code?: string
  quantity: number
  quantity_unit: string
  total_price_gross: number
  tax: unknown
}

export function storedPositions(positions: ReadonlyArray<PositionLike | Position>): StoredPosition[] {
  return positions.map((p) => ({
    name: p.name,
    code: p.code ?? null,
    quantity: p.quantity,
    unit: p.quantity_unit,
    gross: p.total_price_gross,
    tax: String(p.tax),
  }))
}

/** Seller, language and category fields shared by every document. */
export function accountFields(
  o: Pick<ResolvedFakturowniaOptions, "issuePlace" | "departmentId" | "categoryId" | "lang" | "departmentsBySalesChannel">,
  salesChannelId: string | null = null,
): Record<string, unknown> {
  const department = departmentFor(o, salesChannelId)
  return {
    ...(o.issuePlace ? { place: o.issuePlace } : {}),
    ...(department !== null ? { department_id: department } : {}),
    ...(o.categoryId !== null ? { category_id: o.categoryId } : {}),
    lang: o.lang,
  }
}

/** `paid` with no term for a paid document, the payment term otherwise. */
export function paymentFields(args: { paid: boolean; totalGross: number; today: string; termDays: number }): Record<string, unknown> {
  if (args.paid) return { paid: amountText(args.totalGross), payment_to_kind: "off" }
  return { payment_to_kind: args.termDays, payment_to: addDays(args.today, args.termDays) }
}

export interface BuildArgs {
  kind: DocumentKind
  /** `YYYY-MM-DD` in Poland (`warsawDate`). */
  today: string
  /** Send `oid_unique: "yes"`. */
  oidUnique: boolean
}

export function buildDocument(order: OrderRecord, o: ResolvedFakturowniaOptions, args: BuildArgs): BuiltDocument {
  const { positions, totalGross, currency } = buildPositions(order, o)
  const buyer = mapBuyer(order, o.nipSources)
  /* "Captured in full" compares with what the customer had to pay: the order total. */
  const payment = paymentFacts(order.payment_collections ?? [], toNumberOrNull(order.total) ?? totalGross, o.codProviders)
  const paymentType = paymentTypeFor(payment.providerId, payment.cod, o.paymentTypes)
  const oid = orderOid(order.display_id, o.oidPrefix)
  const kind = apiKind(args.kind, o.receiptKind)

  const invoice: Record<string, unknown> = {
    kind,
    issue_date: args.today,
    sell_date: args.today,
    ...accountFields(o, order.sales_channel_id ?? null),
    currency,
    ...(oid ? { oid } : {}),
    ...(oid && args.oidUnique ? { oid_unique: "yes" } : {}),
    payment_type: paymentType,
    ...paymentFields({ paid: payment.captured, totalGross, today: args.today, termDays: o.paymentTermDays }),
    ...buyer.fields,
    positions: positions.map((p) => ({ ...p })),
  }

  return {
    invoice,
    summary: {
      kind: args.kind,
      apiKind: kind,
      oid,
      issueDate: args.today,
      currency,
      totalGross,
      positions: storedPositions(positions),
      buyerType: buyer.type,
      paid: payment.captured,
      paymentType,
      fromInvoiceId: null,
      buyerWarning: buyer.warning,
      orderVersion: typeof order.version === "number" ? order.version : null,
    },
  }
}
