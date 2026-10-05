/**
 * MARKETPLACE ORDERS FROM BASELINKER INTO MEDUSA: the decisions. Pure;
 * imports only other pure files of this folder.
 *
 * BaseLinker collects the orders of Allegro, Amazon, eBay, Erli and the other
 * marketplaces of the account. With `orderImportSources` the plugin turns the
 * ones of chosen sources into Medusa orders, exactly once per BaseLinker
 * order id. This file decides which orders qualify, maps one BaseLinker order
 * to the input of Medusa's order workflow, and reads the payment state.
 *
 * LOOP GUARD, both ways:
 *   - an order this plugin SENT to BaseLinker carries `[medusa:<id>]` in
 *     `admin_comments` (and our own custom source): never imported back;
 *   - an order this plugin IMPORTED carries `metadata.baselinker_imported`:
 *     the export never sends it to BaseLinker again (see `exportVerdict`);
 *   - `metadata.marketplace_order_ref` (`"allegro:<checkout form id>"`) is
 *     shared with the other Koda Plus marketplace plugins: when any Medusa
 *     order already has it, the BaseLinker copy is skipped, and an order that
 *     came straight from a marketplace plugin is not exported to BaseLinker
 *     unless `exportMarketplaceOrders` says so.
 *
 * PERSONAL DATA. The buyer's name, address, e-mail and phone go into the
 * Medusa order (where the store needs them) and nowhere else: the import row
 * keeps ids, totals and statuses only, and the mapping is rebuilt from a
 * fresh read of BaseLinker at import time.
 */

import { ORDER_METADATA } from "./constants"
import { round, toNumber, toNumberOrNull } from "./numbers"
import type { OrderSourceRule } from "./options"

/** A BaseLinker order as `getOrders` returns it; only what the import reads is named. */
export interface BlOrder {
  order_id?: unknown
  external_order_id?: unknown
  order_source?: unknown
  order_source_id?: unknown
  order_status_id?: unknown
  confirmed?: unknown
  date_confirmed?: unknown
  date_add?: unknown
  currency?: unknown
  payment_method?: unknown
  payment_method_cod?: unknown
  payment_done?: unknown
  email?: unknown
  phone?: unknown
  user_comments?: unknown
  admin_comments?: unknown
  delivery_method?: unknown
  delivery_method_id?: unknown
  delivery_price?: unknown
  delivery_fullname?: unknown
  delivery_company?: unknown
  delivery_address?: unknown
  delivery_postcode?: unknown
  delivery_city?: unknown
  delivery_state?: unknown
  delivery_country_code?: unknown
  delivery_point_id?: unknown
  delivery_point_name?: unknown
  delivery_point_address?: unknown
  delivery_point_postcode?: unknown
  delivery_point_city?: unknown
  delivery_package_module?: unknown
  delivery_package_nr?: unknown
  invoice_fullname?: unknown
  invoice_company?: unknown
  invoice_nip?: unknown
  invoice_address?: unknown
  invoice_postcode?: unknown
  invoice_city?: unknown
  invoice_state?: unknown
  invoice_country_code?: unknown
  want_invoice?: unknown
  products?: unknown
  [key: string]: unknown
}

export interface BlOrderLine {
  product_id?: unknown
  variant_id?: unknown
  name?: unknown
  sku?: unknown
  ean?: unknown
  price_brutto?: unknown
  tax_rate?: unknown
  quantity?: unknown
  order_product_id?: unknown
}

function text(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v !== "string") return null
  const t = v.trim()
  return t ? t : null
}

function id(v: unknown): string | null {
  const t = text(v)
  return t && /^\d+$/.test(t) && Number(t) > 0 ? String(Number(t)) : null
}

/** The lines of an order, whichever shape (list or map) BaseLinker sent. */
export function orderLines(o: BlOrder): BlOrderLine[] {
  const raw = o.products
  if (Array.isArray(raw)) return raw.filter((l) => l && typeof l === "object") as BlOrderLine[]
  if (raw && typeof raw === "object") return Object.values(raw as Record<string, unknown>).filter((l) => l && typeof l === "object") as BlOrderLine[]
  return []
}

/** Gross total: lines (price times quantity) plus delivery. */
export function orderTotal(o: BlOrder): number {
  const lines = orderLines(o).reduce((sum, l) => sum + toNumber(l.price_brutto) * Math.max(0, Math.round(toNumber(l.quantity))), 0)
  return round(lines + toNumber(o.delivery_price), 2)
}

/* ------------------------------------------------------------------ */
/* Which orders qualify                                                */
/* ------------------------------------------------------------------ */

export type ImportVerdict =
  | { import: true }
  | { import: false; reason: "own_export" | "own_source" | "not_selected" | "unconfirmed" | "no_id" }

/** The marker the order export writes into `admin_comments`. */
export const OWN_MARKER = /\[medusa:[^\]\s]+\]/

export function sourceSelected(type: string, sourceId: number | null, rules: readonly OrderSourceRule[]): boolean {
  const t = type.toLowerCase()
  return rules.some((r) => r.type === t && (r.id === null || r.id === sourceId))
}

/**
 * Whether a BaseLinker order is one to import. Our own exports never come
 * back: neither by the marker nor by our custom source.
 */
export function importVerdict(o: BlOrder, opts: { rules: readonly OrderSourceRule[]; customSourceId: number | null }): ImportVerdict {
  if (!id(o.order_id)) return { import: false, reason: "no_id" }
  if (OWN_MARKER.test(String(o.admin_comments ?? ""))) return { import: false, reason: "own_export" }
  const type = (text(o.order_source) ?? "").toLowerCase()
  const sourceId = toNumberOrNull(o.order_source_id)
  if (type === "personal" && opts.customSourceId !== null && sourceId === opts.customSourceId) return { import: false, reason: "own_source" }
  if (!sourceSelected(type, sourceId, opts.rules)) return { import: false, reason: "not_selected" }
  if (o.confirmed === false || o.confirmed === 0 || o.confirmed === "0") return { import: false, reason: "unconfirmed" }
  return { import: true }
}

/**
 * `"<source>:<external id>"`, lowercased, the key every Koda Plus marketplace
 * plugin writes into `metadata.marketplace_order_ref`. For Allegro the
 * external id is the order (checkout form) id. Null without an external id.
 */
export function marketplaceRef(o: BlOrder): string | null {
  const type = (text(o.order_source) ?? "").toLowerCase()
  const external = text(o.external_order_id)
  if (!type || !external || type === "personal") return null
  return `${type}:${external}`.toLowerCase()
}

/* ------------------------------------------------------------------ */
/* Payment                                                             */
/* ------------------------------------------------------------------ */

export type PaymentState = "paid" | "cod" | "partial" | "awaiting"

/** Paid in full, cash on delivery (the courier collects), part paid, or not paid yet. */
export function paymentState(o: BlOrder): PaymentState {
  const total = orderTotal(o)
  const done = toNumber(o.payment_done)
  const cod = o.payment_method_cod === "1" || o.payment_method_cod === 1 || o.payment_method_cod === true
  if (total > 0 && done + 0.005 >= total) return "paid"
  if (cod) return "cod"
  return done > 0 ? "partial" : "awaiting"
}

/* ------------------------------------------------------------------ */
/* Mapping into Medusa                                                 */
/* ------------------------------------------------------------------ */

export interface ImportContext {
  regionId: string
  salesChannelId: string | null
  shippingOptionId: string | null
  /** BaseLinker card id (product or variant) to Medusa variant id. */
  links: ReadonlyMap<string, string>
}

export interface MappedLine {
  variant_id?: string
  title: string
  quantity: number
  unit_price: number
  is_tax_inclusive: true
  metadata: Record<string, unknown>
}

export interface MappedOrder {
  /** Input of `createOrderWorkflow` (as a draft; the conversion places it). */
  input: Record<string, unknown>
  /**
   * The buyer's e-mail, set on the order after it exists. Given to
   * `createOrderWorkflow`, it would find or create a guest customer, and a
   * store that welcomes new customers (`customer.created`) would mail a
   * marketplace buyer.
   */
  email: string | null
  lines: number
  unlinked: string[]
  total: number
  currency: string
  ref: string | null
  payment: PaymentState
}

export class ImportMappingError extends Error {
  readonly code: string
  readonly retryable = false
  constructor(code: string, message: string) {
    super(message)
    this.name = "ImportMappingError"
    this.code = code
  }
}

/** "Jan Kowalski" into first and last name; one word stays the first name. */
export function splitName(full: string | null): { first_name: string; last_name: string } {
  const parts = (full ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
  if (parts.length === 0) return { first_name: "", last_name: "" }
  if (parts.length === 1) return { first_name: parts[0], last_name: "" }
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") }
}

function address(o: BlOrder, kind: "delivery" | "invoice"): Record<string, unknown> | null {
  const f = (k: string) => text(o[`${kind}_${k}`])
  const fullname = f("fullname")
  const company = f("company")
  const street = f("address")
  const city = f("city")
  if (!fullname && !company && !street && !city) return null
  return {
    ...splitName(fullname),
    company: company ?? undefined,
    address_1: street ?? undefined,
    postal_code: f("postcode") ?? undefined,
    city: city ?? undefined,
    province: f("state") ?? undefined,
    country_code: (f("country_code") ?? "").toLowerCase() || undefined,
    phone: text(o.phone) ?? undefined,
  }
}

/** Card id of a line: the variant id when BaseLinker gives one, else the product id. */
function lineVariant(l: BlOrderLine, links: ReadonlyMap<string, string>): string | undefined {
  const variant = id(l.variant_id)
  const product = id(l.product_id)
  return (variant ? links.get(variant) : undefined) ?? (product ? links.get(product) : undefined)
}

export function mapOrder(o: BlOrder, ctx: ImportContext): MappedOrder {
  const blId = id(o.order_id)
  if (!blId) throw new ImportMappingError("no_id", "The BaseLinker order has no id.")
  const currency = (text(o.currency) ?? "").toLowerCase()
  if (!/^[a-z]{3}$/.test(currency)) throw new ImportMappingError("no_currency", `BaseLinker order ${blId} has no currency.`)
  const unlinked: string[] = []
  const items: MappedLine[] = []
  for (const l of orderLines(o)) {
    const quantity = Math.round(toNumber(l.quantity))
    if (quantity <= 0) continue
    const variantId = lineVariant(l, ctx.links)
    const sku = text(l.sku)
    const title = (text(l.name) ?? sku ?? "Item").slice(0, 200)
    if (!variantId) unlinked.push(sku ?? title)
    items.push({
      ...(variantId ? { variant_id: variantId } : {}),
      title,
      quantity,
      unit_price: round(toNumber(l.price_brutto), 2),
      is_tax_inclusive: true,
      metadata: {
        baselinker_order_product_id: text(l.order_product_id),
        baselinker_product_id: id(l.product_id),
        ...(sku ? { sku } : {}),
        ...(toNumberOrNull(l.tax_rate) !== null ? { baselinker_tax_rate: toNumberOrNull(l.tax_rate) } : {}),
      },
    })
  }
  if (items.length === 0) throw new ImportMappingError("no_lines", `BaseLinker order ${blId} has no lines.`)

  const shipping = address(o, "delivery")
  const wantsInvoice = o.want_invoice === "1" || o.want_invoice === 1 || o.want_invoice === true
  const billing = (wantsInvoice ? address(o, "invoice") : null) ?? shipping
  const ref = marketplaceRef(o)
  const point = text(o.delivery_point_id)
  const source = (text(o.order_source) ?? "").toLowerCase()
  const metadata: Record<string, unknown> = {
    [ORDER_METADATA.orderId]: blId,
    [ORDER_METADATA.imported]: true,
    [ORDER_METADATA.source]: source,
    [ORDER_METADATA.externalOrderId]: text(o.external_order_id),
    ...(ref ? { [ORDER_METADATA.marketplaceRef]: ref } : {}),
    ...(text(o.user_comments) ? { customer_note: text(o.user_comments) } : {}),
    ...(wantsInvoice ? { invoice: true } : {}),
    ...(wantsInvoice && text(o.invoice_nip) ? { invoice_nip: text(o.invoice_nip) } : {}),
    ...(wantsInvoice && text(o.invoice_company) ? { invoice_company: text(o.invoice_company) } : {}),
  }
  const shippingData: Record<string, unknown> = {
    baselinker_delivery_method: text(o.delivery_method),
    ...(point
      ? {
          pickup_point: {
            id: point,
            name: text(o.delivery_point_name),
            address: text(o.delivery_point_address),
            postcode: text(o.delivery_point_postcode),
            city: text(o.delivery_point_city),
          },
        }
      : {}),
  }
  const total = orderTotal(o)
  return {
    input: {
      region_id: ctx.regionId,
      ...(ctx.salesChannelId ? { sales_channel_id: ctx.salesChannelId } : {}),
      currency_code: currency,
      status: "draft",
      is_draft_order: true,
      /* The marketplace talks to its buyer; the store's own e-mails stay quiet. */
      no_notification: true,
      ...(shipping ? { shipping_address: shipping } : {}),
      ...(billing ? { billing_address: billing } : {}),
      items,
      shipping_methods: [
        {
          name: (text(o.delivery_method) ?? "Delivery").slice(0, 100),
          amount: round(toNumber(o.delivery_price), 2),
          is_tax_inclusive: true,
          ...(ctx.shippingOptionId ? { shipping_option_id: ctx.shippingOptionId } : {}),
          data: shippingData,
        },
      ],
      metadata,
    },
    email: text(o.email),
    lines: items.length,
    unlinked,
    total,
    currency,
    ref,
    payment: paymentState(o),
  }
}

/* ------------------------------------------------------------------ */
/* Discovery paging, age, statuses                                     */
/* ------------------------------------------------------------------ */

export interface ImportCursor {
  /** `date_confirmed` the next read starts from (unix seconds). */
  dateConfirmed: number
  /** Order ids already seen at exactly that second (the next read starts at the same second). */
  seen: number[]
}

/**
 * Where the next read starts after a page. BaseLinker documents "the last
 * date_confirmed plus one second", which loses orders confirmed in the same
 * second as a page boundary. The plugin starts at the same second and skips
 * the ids it has seen there; only when a whole page shares one second does
 * it move on by one, so the read always advances.
 */
export function nextCursor(cursor: ImportCursor, page: readonly BlOrder[], pageSize: number): { cursor: ImportCursor; more: boolean } {
  if (page.length === 0) return { cursor, more: false }
  const last = Math.max(...page.map((o) => Math.floor(toNumber(o.date_confirmed))))
  const atLast = page.filter((o) => Math.floor(toNumber(o.date_confirmed)) === last).map((o) => Number(id(o.order_id) ?? 0))
  const seen = last === cursor.dateConfirmed ? [...new Set([...cursor.seen, ...atLast])] : atLast
  const full = page.length >= pageSize
  if (full && page.every((o) => Math.floor(toNumber(o.date_confirmed)) === last)) {
    return { cursor: { dateConfirmed: last + 1, seen: [] }, more: true }
  }
  return { cursor: { dateConfirmed: last, seen }, more: full }
}

/** Orders of a page that are new for the cursor (not one of the ids seen at its second). */
export function unseen(cursor: ImportCursor, page: readonly BlOrder[]): BlOrder[] {
  return page.filter((o) => !(Math.floor(toNumber(o.date_confirmed)) === cursor.dateConfirmed && cursor.seen.includes(Number(id(o.order_id) ?? 0))))
}

/** An order confirmed longer ago than the limit is not imported by the writer on its own. */
export function tooOld(confirmedAtUnix: number | null, maxAgeHours: number, now: Date): boolean {
  if (confirmedAtUnix === null) return false
  return now.getTime() - confirmedAtUnix * 1000 > maxAgeHours * 3600 * 1000
}

export type CancelDecision = "cancel" | "flag" | "none"

/**
 * A cancelling BaseLinker status (`orderImportCancelStatusIds`) cancels the
 * Medusa order only while nothing of it is fulfilled; otherwise a person
 * decides (`cancel_blocked`).
 */
export function cancelDecision(args: { statusId: number | null; cancelIds: readonly number[]; fulfilledQuantity: number; alreadyCanceled: boolean }): CancelDecision {
  if (args.statusId === null || !args.cancelIds.includes(args.statusId) || args.alreadyCanceled) return "none"
  return args.fulfilledQuantity > 0 ? "flag" : "cancel"
}

/* ------------------------------------------------------------------ */
/* The export side of the loop guard                                   */
/* ------------------------------------------------------------------ */

export type ExportVerdict = { send: true } | { send: false; reason: "imported" | "marketplace"; ref: string | null }

/**
 * Whether a Medusa order may go to BaseLinker. Never one this plugin
 * imported; not one another plugin took straight from a marketplace, unless
 * `exportMarketplaceOrders` is on (BaseLinker would otherwise hold it twice,
 * once from its own marketplace integration).
 */
export function exportVerdict(metadata: Record<string, unknown> | null | undefined, exportMarketplaceOrders: boolean): ExportVerdict {
  const m = metadata ?? {}
  const imported = m[ORDER_METADATA.imported]
  if (imported === true || imported === "true") return { send: false, reason: "imported", ref: typeof m[ORDER_METADATA.marketplaceRef] === "string" ? (m[ORDER_METADATA.marketplaceRef] as string) : null }
  const ref = typeof m[ORDER_METADATA.marketplaceRef] === "string" && (m[ORDER_METADATA.marketplaceRef] as string).trim() ? (m[ORDER_METADATA.marketplaceRef] as string) : null
  if (ref && !exportMarketplaceOrders) return { send: false, reason: "marketplace", ref }
  return { send: true }
}
