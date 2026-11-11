/**
 * KUP TERAZ, WRITE SIDE: pure decisions, zero runtime imports.
 *
 *   importDecision   is this stored order imported now, and if not, why
 *   toMedusaOrder    the Medusa draft order built from the stored row and the
 *                    personal data read from Ceneo at import time (the plugin
 *                    never stores them; they live only in the Medusa order)
 *   nextWrite        the next write Ceneo should get for an order
 *   cancelDecision   what a cancellation at Ceneo does to the Medusa order
 *
 * This file WRITES marketplace keys into the metadata of the order it
 * creates (`marketplace_order_ref`, `ceneo_*`). Nothing in the plugin reads
 * them back: the link is `ceneo_order.medusa_order_id`.
 */

import type { CeneoOrderDetailRaw } from "./kup-teraz"

export type ImportStatus = "importing" | "imported" | "held" | "failed"
export const IMPORT_MAX_ATTEMPTS = 5
export const IMPORT_LEASE_MS = 10 * 60_000
/** Pauses before attempt 2, 3, 4, 5. */
export const IMPORT_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000]

export interface StoredItem {
  shop_product_id: string | null
  name: string | null
  price: number | null
  quantity: number | null
  total: number | null
  returned: number | null
  variant_id: string | null
}

/** The `ceneo_order` columns the write side reads. */
export interface ImportRow {
  id: string
  ceneo_order_id: string
  displayed_order_id: string | null
  state_id: number | null
  amounts: { order?: number | null; products?: number | null; delivery?: number | null } | null
  delivery_form: string | null
  payment_type_id: number | null
  items: StoredItem[] | null
  matched: boolean
  demo: boolean
  medusa_order_id: string | null
  import_status: ImportStatus | null
  import_attempts: number
  import_next_at: Date | string | null
  ceneo_writes: CeneoWrites | null
}

export type ImportSkip = "mode" | "done" | "busy" | "held" | "state" | "unmatched" | "backoff" | "exhausted"

export function importDecision(row: ImportRow, ctx: { demo: boolean; importStates: readonly number[]; now: number }): { kind: "import" } | { kind: "skip"; reason: ImportSkip } {
  if (row.demo !== ctx.demo) return { kind: "skip", reason: "mode" }
  if (row.import_status === "imported") return { kind: "skip", reason: "done" }
  if (row.import_status === "importing") return { kind: "skip", reason: "busy" }
  if (row.import_status === "held") return { kind: "skip", reason: "held" }
  /* A draft an earlier attempt created is finished whatever the state is now. */
  if (row.medusa_order_id && row.import_status !== "failed") return { kind: "skip", reason: "done" }
  if (!row.medusa_order_id) {
    if (row.state_id === null || !ctx.importStates.includes(row.state_id)) return { kind: "skip", reason: "state" }
    if (!row.matched) return { kind: "skip", reason: "unmatched" }
  }
  if (row.import_status === "failed") {
    if (row.import_attempts >= IMPORT_MAX_ATTEMPTS) return { kind: "skip", reason: "exhausted" }
    const at = row.import_next_at ? new Date(row.import_next_at).getTime() : 0
    if (at > ctx.now) return { kind: "skip", reason: "backoff" }
  }
  return { kind: "import" }
}

export function nextAttemptAt(attempts: number, now: number): Date | null {
  if (attempts >= IMPORT_MAX_ATTEMPTS) return null
  return new Date(now + IMPORT_BACKOFF_MS[Math.min(IMPORT_BACKOFF_MS.length - 1, Math.max(0, attempts - 1))])
}

/* ---- the Medusa order ---------------------------------------------- */

export interface MedusaAddressInput {
  first_name?: string
  last_name?: string
  company?: string
  address_1?: string
  city?: string
  postal_code?: string
  province?: string
  country_code?: string
  phone?: string
}

export interface MedusaOrderInput {
  region_id: string
  sales_channel_id: string
  currency_code: "pln"
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

export type BuildProblem = "no_items" | "item_unmatched" | "no_address"

const COUNTRIES: Record<string, string> = { polska: "pl", poland: "pl", pl: "pl", niemcy: "de", germany: "de", czechy: "cz", "czech republic": "cz", słowacja: "sk", slovakia: "sk", litwa: "lt", lithuania: "lt" }

export function countryCode(v: unknown): string {
  const k = typeof v === "string" ? v.trim().toLowerCase() : ""
  if (/^[a-z]{2}$/.test(k)) return k
  return COUNTRIES[k] ?? "pl"
}

const t = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : typeof v === "number" ? String(v) : undefined)

/** Ceneo writes the postal code with whatever dash the shop had; Medusa gets `54-202`. */
export function postalCode(v: unknown): string | undefined {
  const s = t(v)
  if (!s) return undefined
  const digits = s.replace(/\D/g, "")
  return /^\d{5}$/.test(digits) ? `${digits.slice(0, 2)}-${digits.slice(2)}` : s
}

function clean<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || o[k] === "") delete o[k]
  return o
}

export function shippingAddress(s: Record<string, unknown> | undefined): MedusaAddressInput | null {
  if (!s || !t(s.ShippingAddress) || !t(s.ShippingCity)) return null
  return clean({
    first_name: t(s.ShippingFirstName),
    last_name: t(s.ShippingLastName),
    company: t(s.ShippingCompanyName),
    address_1: t(s.ShippingAddress),
    city: t(s.ShippingCity),
    postal_code: postalCode(s.ShippingPostCode),
    province: t(s.ShippingRegion),
    country_code: countryCode(s.ShippingCountry),
    phone: t(s.PhoneNumber),
  })
}

export function invoiceAddress(i: Record<string, unknown> | undefined, phone: string | undefined): MedusaAddressInput | null {
  if (!i || !t(i.InvoiceAddress) || !t(i.InvoiceCity)) return null
  return clean({
    first_name: t(i.InvoiceFirstName),
    last_name: t(i.InvoiceLastName),
    company: t(i.InvoiceCompanyName),
    address_1: t(i.InvoiceAddress),
    city: t(i.InvoiceCity),
    postal_code: postalCode(i.InvoicePostCode),
    province: t(i.InvoiceRegion),
    country_code: countryCode(i.InvoiceCountry),
    phone,
  })
}

export const marketplaceRef = (ceneoOrderId: string) => `ceneo:${ceneoOrderId}`

export function toMedusaOrder(
  row: ImportRow,
  detail: CeneoOrderDetailRaw,
  ctx: { regionId: string; salesChannelId: string; shippingOptionId: string | null },
): { ok: true; order: MedusaOrderInput; email: string | null } | { ok: false; problem: BuildProblem } {
  const items = (row.items ?? []).filter((i) => (Number(i.quantity) || 0) > 0)
  if (items.length === 0) return { ok: false, problem: "no_items" }
  if (items.some((i) => !i.variant_id)) return { ok: false, problem: "item_unmatched" }
  const ship = detail.shipping[0]
  const pickup = detail.pickup[0]
  let shipping_address = shippingAddress(ship)
  /* A parcel locker order may come with the buyer's name only: the point is the delivery address. */
  if (!shipping_address && ship && pickup && t(pickup.StreetAddress) && t(pickup.City)) {
    shipping_address = clean({
      first_name: t(ship.ShippingFirstName),
      last_name: t(ship.ShippingLastName),
      address_1: t(pickup.StreetAddress),
      city: t(pickup.City),
      postal_code: postalCode(pickup.PostCode),
      country_code: "pl",
      phone: t(ship.PhoneNumber),
    })
  }
  if (!shipping_address) return { ok: false, problem: "no_address" }
  const billing_address = invoiceAddress(detail.invoice[0], shipping_address.phone) ?? { ...shipping_address }
  const nip = t(detail.invoice[0]?.InvoiceNIP)
  const email = t(ship?.Email) ?? null
  const order: MedusaOrderInput = {
    region_id: ctx.regionId,
    sales_channel_id: ctx.salesChannelId,
    currency_code: "pln",
    status: "draft",
    is_draft_order: true,
    /* Ceneo talks to its buyer: Medusa sends nothing for this order. */
    no_notification: true,
    shipping_address,
    billing_address,
    items: items.map((i) => ({
      variant_id: String(i.variant_id),
      title: (i.name ?? i.shop_product_id ?? "Ceneo").slice(0, 200),
      quantity: Math.floor(Number(i.quantity)),
      /* Ceneo prices are gross PLN; the order keeps Ceneo's price, not the store's current one. */
      unit_price: Number(i.price) || 0,
      is_tax_inclusive: true,
      is_discountable: false,
      requires_shipping: true,
      metadata: clean({ ceneo_offer_id: i.shop_product_id ?? undefined }),
    })),
    shipping_methods: [
      {
        name: (row.delivery_form ?? "Ceneo Kup Teraz").slice(0, 200),
        amount: Number(row.amounts?.delivery) || 0,
        is_tax_inclusive: true,
        ...(ctx.shippingOptionId ? { shipping_option_id: ctx.shippingOptionId } : {}),
        data: clean({ ceneo_pickup_point: t(pickup?.Name) }),
      },
    ],
    metadata: clean({
      marketplace_order_ref: marketplaceRef(row.ceneo_order_id),
      ceneo_order_id: row.ceneo_order_id,
      ceneo_displayed_order_id: row.displayed_order_id ?? undefined,
      ceneo_pickup_point: t(pickup?.Name),
      ceneo_invoice_nip: nip,
      ceneo_invoice_proforma: detail.invoice[0]?.InvoiceProformaRequested === true ? true : undefined,
      ceneo_customer_remark: detail.remark ? detail.remark.slice(0, 1000) : undefined,
      koda_demo: row.demo ? true : undefined,
    }),
  }
  return { ok: true, order, email }
}

/* ---- what Ceneo learns ---------------------------------------------- */

/** `ceneo_order.ceneo_writes`: what was sent to Ceneo and what waits. ISO dates. */
export interface CeneoWrites {
  shop_order_id?: string | null
  shop_order_id_at?: string | null
  confirmed_at?: string | null
  shipment?: { tracking: string; carrier_id: number; queued_at: string; sent_at?: string | null } | null
  sent_at?: string | null
  /** Shipped in Medusa without a parcel number: only "sent" goes to Ceneo. */
  send_requested_at?: string | null
  cancel?: { reason: string; queued_at: string; sent_at?: string | null } | null
  /** Cancelled because Ceneo cancelled: nothing goes back. */
  canceled_by_ceneo_at?: string | null
  error?: string | null
  error_at?: string | null
  /** Consecutive item failures of the next write; at WRITE_MAX_ATTEMPTS it waits for a person. */
  attempts?: number
  /** A person must look (a fulfilled order cancelled at Ceneo, a write that keeps failing). */
  attention?: string | null
}

export const WRITE_MAX_ATTEMPTS = 5

export type NextWrite =
  | { kind: "shop_order_id"; shopOrderId: string }
  | { kind: "confirm" }
  | { kind: "shipment"; tracking: string; carrierId: number }
  | { kind: "send" }
  | { kind: "cancel"; reason: string }

/**
 * The next write for an imported order, or null. In this order: the shop
 * order number and the confirmation once imported, then a cancellation
 * (which wins over a shipment), then the parcel number and "sent".
 */
export function nextWrite(row: Pick<ImportRow, "import_status" | "medusa_order_id" | "ceneo_writes">, displayId: string | null): NextWrite | null {
  const w = row.ceneo_writes ?? {}
  if (row.import_status !== "imported" || !row.medusa_order_id) return null
  if ((w.attempts ?? 0) >= WRITE_MAX_ATTEMPTS || w.canceled_by_ceneo_at) return null
  if (w.cancel) return w.cancel.sent_at ? null : { kind: "cancel", reason: w.cancel.reason }
  if (!w.shop_order_id_at && displayId) return { kind: "shop_order_id", shopOrderId: displayId }
  if (!w.confirmed_at) return { kind: "confirm" }
  if (w.shipment && !w.shipment.sent_at) return { kind: "shipment", tracking: w.shipment.tracking, carrierId: w.shipment.carrier_id }
  if ((w.shipment?.sent_at || w.send_requested_at) && !w.sent_at) return { kind: "send" }
  return null
}

/** The writes after one successful write. */
export function afterWrite(w: CeneoWrites | null, done: NextWrite, at: string, shopOrderId?: string): CeneoWrites {
  const next: CeneoWrites = { ...(w ?? {}), error: null, error_at: null, attempts: 0 }
  if (done.kind === "shop_order_id") {
    next.shop_order_id = shopOrderId ?? done.shopOrderId
    next.shop_order_id_at = at
  } else if (done.kind === "confirm") next.confirmed_at = at
  else if (done.kind === "shipment" && next.shipment) next.shipment = { ...next.shipment, sent_at: at }
  else if (done.kind === "send") next.sent_at = at
  else if (done.kind === "cancel" && next.cancel) next.cancel = { ...next.cancel, sent_at: at }
  return next
}

export function afterWriteFailure(w: CeneoWrites | null, message: string, at: string, countsAttempt: boolean): CeneoWrites {
  const attempts = (w?.attempts ?? 0) + (countsAttempt ? 1 : 0)
  return { ...(w ?? {}), error: message.slice(0, 500), error_at: at, attempts, attention: attempts >= WRITE_MAX_ATTEMPTS ? `Ceneo refused this write ${attempts} times: ${message.slice(0, 300)}` : (w?.attention ?? null) }
}

/** The first tracking number of the fulfillments, newest first. */
export function trackingOf(fulfillments: ReadonlyArray<{ created_at?: string | Date | null; labels?: ReadonlyArray<{ tracking_number?: string | null } | null> | null } | null>): string | null {
  const sorted = fulfillments.filter((f): f is NonNullable<typeof f> => Boolean(f)).sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
  for (const f of sorted) for (const l of f.labels ?? []) if (l?.tracking_number && l.tracking_number.trim()) return l.tracking_number.trim().slice(0, 100)
  return null
}

export type CancelDecision = { kind: "cancel" } | { kind: "already" } | { kind: "attention"; reason: string } | { kind: "none" }

/** Ceneo cancelled an order: Medusa cancels its order unless something was shipped. */
export function cancelDecision(stateId: number | null, canceledStates: readonly number[], medusa: { status: string | null; fulfilled: boolean } | null): CancelDecision {
  if (stateId === null || !canceledStates.includes(stateId) || !medusa) return { kind: "none" }
  if (medusa.status === "canceled") return { kind: "already" }
  if (medusa.fulfilled) return { kind: "attention", reason: "Cancelled at Ceneo after a fulfillment in Medusa: handle the return by hand." }
  return { kind: "cancel" }
}

/** What the admin shows for an order's import. */
export type ImportState = "imported" | "importing" | "held" | "failed" | "queued" | "waiting_state" | "waiting_match" | "off"

export function importStateOf(row: Pick<ImportRow, "import_status" | "medusa_order_id" | "state_id" | "matched">, importStates: readonly number[]): ImportState {
  if (row.import_status) return row.import_status
  if (row.medusa_order_id) return "imported"
  if (importStates.length === 0) return "off"
  if (row.state_id === null || !importStates.includes(row.state_id)) return "waiting_state"
  if (!row.matched) return "waiting_match"
  return "queued"
}

/** The keys of `after` that differ from `before` (removed keys as null): what a merge must write. */
export function writesPatch(before: CeneoWrites | null, after: CeneoWrites): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const b = (before ?? {}) as Record<string, unknown>
  const a = after as Record<string, unknown>
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[k] ?? null) !== JSON.stringify(a[k] ?? null)) out[k] = a[k] ?? null
  }
  return out
}
