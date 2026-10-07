import type { ImportRow, InvoiceRow, OrderRow, ProductRow, StockChangeRow } from "./dto"
import type { CounterDraft, FactDraft, LinkDraft, MessageDraft, SummaryDraft } from "./kit-routes"
import { trackingHosts } from "./tracking"

/**
 * BaseLinker in the koda.integration/1 contract, as pure functions over the
 * plugin's own rows (testable without a database): one line per order,
 * product and inventory item, the facts of the overview card and the board
 * counters.
 *
 * The worst record speaks: red (not sent, not imported, a quarantined item,
 * a failed stock write), then orange (waits for a person), blue (under way),
 * green (in BaseLinker, imported, linked, in step), grey (skipped, with its
 * reason code in the title key). Nothing comes from order metadata: the
 * rows are the plugin's record.
 */

/** Hosts an external link may point to: the carriers' tracking pages and BaseLinker. */
export const BASELINKER_EXTERNAL_HOSTS: readonly string[] = [...trackingHosts(), "baselinker.com"]

export const ORDER_WIDGET = "baselinker.order"
export const PRODUCT_WIDGET = "baselinker.product"

type State = SummaryDraft["state"]
type Line = { state: State; title: MessageDraft; detail?: MessageDraft; rank: number }

const RANK: Record<State, number> = { failed: 0, attention: 1, active: 2, ok: 3, none: 4, off: 5, unavailable: 6 }

const m = (key: string, params?: Record<string, string | number>): MessageDraft => (params ? { key: `integration.${key}`, params } : { key: `integration.${key}` })

const line = (state: State, title: MessageDraft, detail?: MessageDraft): Line => ({ state, title, ...(detail ? { detail } : {}), rank: RANK[state] })

function ms(v: Date | string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isFinite(t) ? t : 0
}

function latest(...values: Array<Date | string | null | undefined>): Date | null {
  const t = Math.max(0, ...values.map(ms))
  return t > 0 ? new Date(t) : null
}

/* ------------------------------------------------------------------ */
/* Admin deep links (the page reads section, filter and q)             */
/* ------------------------------------------------------------------ */

function query(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v))
  return p.toString()
}

export const deepLink = {
  orders: (filter?: string | null, q?: string | number | null): LinkDraft => ({ kind: "admin", href: `/baselinker?${query({ section: "orders", filter, q })}` }),
  imports: (filter?: string | null, q?: string | number | null): LinkDraft => ({ kind: "admin", href: `/baselinker?${query({ section: "imports", filter, q })}` }),
  cards: (filter?: string | null, q?: string | null): LinkDraft => ({ kind: "admin", href: `/baselinker?${query({ section: "cards", filter, q })}` }),
  plans: (filter?: string | null, q?: string | null): LinkDraft => ({ kind: "admin", href: `/baselinker?${query({ view: "settings", tab: "plans", filter, q })}` }),
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

const SKIP_CODES = new Set(["canceled", "skip_key", "marketplace_order", "imported"])

/** The line of the export row: sent green, queued blue, a failed attempt or a failed fulfillment orange, failed red, skipped grey. */
export function exportLine(row: OrderRow): Line {
  switch (row.status) {
    case "sent":
      if (row.last_error_code === "fulfillment_failed") return line("attention", m("order.fulfillmentFailed"), m("order.fulfillByHand"))
      return line("ok", row.bl_status_name ? m("order.sentStatus", { status: row.bl_status_name }) : m("order.sent"))
    case "pending":
      return (row.attempts ?? 0) > 0 && row.last_error_code
        ? line("attention", m("order.retrying"), m("order.attempt", { attempts: row.attempts ?? 0, code: row.last_error_code }))
        : line("active", m("order.queued"))
    case "failed":
      return line("failed", m("order.failed"), row.last_error_code ? m("order.code", { code: row.last_error_code }) : undefined)
    default: {
      const code = row.last_error_code && SKIP_CODES.has(row.last_error_code) ? row.last_error_code : "other"
      return line("none", m(`order.skip.${code}`))
    }
  }
}

/** The line of the import row: imported green, a blocked cancellation orange, under way blue, failed red, skipped grey. */
export function importLine(row: ImportRow): Line {
  const source = sourceName(row.source)
  switch (row.status) {
    case "imported":
      if (row.flag === "cancel_blocked") return line("attention", m("order.cancelBlocked"), m("order.cancelByHand"))
      return line("ok", row.bl_status_name ? m("order.importedStatus", { source, status: row.bl_status_name }) : m("order.imported", { source }))
    case "pending":
      return line("active", m("order.importing"))
    case "failed":
      return line("failed", m("order.importFailed"), row.last_error_code ? m("order.code", { code: row.last_error_code }) : undefined)
    default:
      return line("none", m("order.importSkipped"), row.last_error_code ? m("order.code", { code: row.last_error_code }) : undefined)
  }
}

const SOURCES: Record<string, string> = {
  allegro: "Allegro",
  amazon: "Amazon",
  ebay: "eBay",
  erli: "Erli",
  emag: "eMAG",
  kaufland: "Kaufland",
  empik: "Empik",
  olx: "OLX",
  shopee: "Shopee",
  personal: "BaseLinker",
  shop: "BaseLinker",
}

/** The marketplace as people name it, from BaseLinker's source type. */
export function sourceName(source: string | null | undefined): string {
  const s = String(source ?? "").trim().toLowerCase()
  if (!s) return "BaseLinker"
  return SOURCES[s] ?? s.charAt(0).toUpperCase() + s.slice(1)
}

/** `channel` (priority 60, code "baselinker"): the marketplace an imported order came from through BaseLinker. */
export function channelFact(row: ImportRow): FactDraft {
  const ref = row.external_order_id || row.marketplace_ref
  return {
    slot: "channel",
    priority: 60,
    code: "baselinker",
    value: m("fact.channel", { source: sourceName(row.source) }),
    ...(ref ? { sub: m("fact.channelRef", { ref }) } : {}),
    link: deepLink.imports(null, row.bl_order_id),
  }
}

/** `delivery` (priority 50, a mirror of what the warehouse entered in BaseLinker): carrier, number and its tracking page. */
export function deliveryFact(row: Pick<OrderRow, "tracking_number" | "tracking_url" | "carrier" | "demo">): FactDraft | null {
  if (!row.tracking_number) return null
  const fact: FactDraft = {
    slot: "delivery",
    priority: 50,
    value: row.carrier ? m("fact.parcel", { carrier: row.carrier }) : m("fact.parcelUnknown"),
    sub: m("fact.tracking", { number: row.tracking_number }),
  }
  /* Simulated numbers never link to a carrier; the kit drops a link outside the allowed hosts. */
  if (row.tracking_url && !row.demo) fact.link = { kind: "external", href: row.tracking_url }
  return fact
}

/** `document` (priority 50; Fakturownia's own document speaks louder with 80): the invoice number BaseLinker holds. */
export function documentFact(invoices: readonly InvoiceRow[]): FactDraft | null {
  const held = invoices.filter((i) => i.status === "written" && i.number).sort((a, b) => ms(b.written_at) - ms(a.written_at))[0]
  if (!held) return null
  const key = held.kind === "vat" ? "fact.invoice" : held.kind === "receipt" ? "fact.receipt" : "fact.document"
  return { slot: "document", priority: 50, value: m(key, { number: held.number as string }), sub: m("fact.documentSub", { field: held.field }) }
}

const PAYMENT: Record<string, { code: string; tone: FactDraft["tone"] }> = {
  paid: { code: "paid", tone: "green" },
  cod: { code: "cod", tone: "blue" },
  partial: { code: "pending", tone: "orange" },
  awaiting: { code: "pending", tone: "orange" },
}

/** `payment` (priority 50) of an imported order, as BaseLinker reported it: "cod" lets a host fulfill it unpaid. */
export function paymentFact(row: ImportRow): FactDraft | null {
  const p = row.payment_state ? PAYMENT[row.payment_state] : undefined
  if (!p || row.status !== "imported") return null
  return { slot: "payment", priority: 50, code: p.code, tone: p.tone, value: m(`fact.${row.payment_state}`), sub: m("fact.paymentSub") }
}

export interface OrderRows {
  exported: OrderRow | null
  imported: ImportRow | null
  invoices: InvoiceRow[]
}

/** The line of one order from the plugin's rows of the current mode; undefined when the plugin has none. */
export function orderSummary(rows: OrderRows, ctx: { demo: boolean }): SummaryDraft | undefined {
  const { exported, imported } = rows
  if (!exported && !imported) return undefined
  const lines: Array<{ l: Line; from: "export" | "import" }> = []
  if (exported) lines.push({ l: exportLine(exported), from: "export" })
  if (imported) lines.push({ l: importLine(imported), from: "import" })
  /* The worst record speaks; on a tie the import (where the order came from). */
  const worst = [...lines].sort((a, b) => a.l.rank - b.l.rank || (a.from === "import" ? -1 : 1))[0]

  const facts: FactDraft[] = []
  if (imported) {
    facts.push(channelFact(imported))
    const pay = paymentFact(imported)
    if (pay) facts.push(pay)
  }
  const parcel = (imported?.tracking_number ? deliveryFact(imported) : null) ?? (exported ? deliveryFact(exported) : null)
  if (parcel) facts.push(parcel)
  const doc = documentFact(rows.invoices)
  if (doc) facts.push(doc)

  const displayId = exported?.display_id ?? imported?.display_id ?? null
  const links: LinkDraft[] =
    worst.from === "import" && imported
      ? [deepLink.imports(null, imported.bl_order_id)]
      : [deepLink.orders(null, displayId ?? exported?.bl_order_id ?? exported?.order_id ?? null)]

  const detail = worst.l.detail ?? (ctx.demo ? m("order.demo") : undefined)
  return {
    state: worst.l.state,
    title: worst.l.title,
    ...(detail ? { detail } : {}),
    facts,
    counts: { attempts: exported?.attempts ?? imported?.attempts ?? 0 },
    links,
    widget: ORDER_WIDGET,
    updatedAt: latest(exported?.status_checked_at, exported?.sent_at, imported?.status_checked_at, imported?.imported_at),
  }
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export interface ProductRows {
  /** The product's variants (ids and SKUs, read from Medusa by product id). */
  variants: Array<{ id: string; sku?: string | null }>
  /** Cards linked to its variants or carrying one of its SKUs (conflicts), containers left out. */
  cards: ProductRow[]
  /** Item keys of the plans held in quarantine that name this product, its variants or its cards. */
  quarantined: string[]
  /** Rows of the stock plan for this product (either direction). */
  stockChanges: Array<{ delta: number }>
}

/** Linked green, a card conflict on its SKUs orange, a quarantined plan item red; a stock fact when a stock plan exists. */
export function productSummary(productId: string, rows: ProductRows): SummaryDraft | undefined {
  const sellable = rows.cards.filter((c) => c.match_source !== "parent")
  const linked = sellable.filter((c) => c.variant_id && !c.conflict)
  const conflicts = sellable.filter((c) => c.conflict)
  if (linked.length === 0 && conflicts.length === 0 && rows.quarantined.length === 0) return undefined
  const sku = rows.variants.find((v) => v.sku)?.sku ?? null
  const links = [deepLink.cards(null, productId)]

  let state: State
  let title: MessageDraft
  let detail: MessageDraft | undefined
  if (rows.quarantined.length > 0) {
    state = "failed"
    title = m("product.quarantined")
    detail = m("product.quarantinedDetail")
    links.unshift(deepLink.plans("quarantined", sku))
  } else if (conflicts.length > 0) {
    const reason = conflicts[0].conflict ?? ""
    state = "attention"
    title = m(`product.conflict.${CONFLICTS.has(reason) ? reason : "other"}`)
    links.unshift(deepLink.cards("conflicts", sku))
  } else {
    state = "ok"
    title = m("product.linked", { count: linked.length })
    const withCard = new Set(linked.map((c) => c.variant_id))
    const total = rows.variants.length
    if (total > 0 && withCard.size < total) detail = m("product.partly", { linked: withCard.size, total })
  }

  const facts: FactDraft[] = []
  if (rows.stockChanges.length > 0) {
    let added = 0
    let removed = 0
    for (const c of rows.stockChanges) {
      if (c.delta > 0) added += c.delta
      else removed -= c.delta
    }
    facts.push({
      slot: "stock",
      priority: 50,
      tone: "orange",
      value: m("fact.stockPlan", { count: rows.stockChanges.length }),
      sub: m("fact.stockUnits", { added, removed }),
      link: deepLink.plans(null, sku),
    })
  }
  return {
    state,
    title,
    ...(detail ? { detail } : {}),
    facts,
    counts: { cards: linked.length, conflicts: conflicts.length, quarantined: rows.quarantined.length },
    links,
    widget: PRODUCT_WIDGET,
    updatedAt: latest(...rows.cards.map((c) => c.updated_at ?? null)),
  }
}

const CONFLICTS = new Set(["duplicate_sku", "duplicate_ean", "ambiguous_variant"])

/* ------------------------------------------------------------------ */
/* Inventory items                                                     */
/* ------------------------------------------------------------------ */

export interface InventoryRows {
  sku: string | null
  /** Linked, conflict-free cards of the item's variants (their BaseLinker stock). */
  cards: Array<Pick<ProductRow, "bl_product_id" | "stock" | "demo">>
  /** BaseLinker to Medusa: the stock plan rows of this item. */
  changes: Array<Pick<StockChangeRow, "delta" | "status" | "bl_stock" | "medusa_stocked" | "target" | "applied_at" | "created_at">>
  /** Medusa to BaseLinker: the stock push plan rows of the item's variants. */
  pushes: Array<{ status: string; changes?: Array<{ field: string; from: string | number | null; to: string | number | null }> | null }>
  /** A stock write of one of its cards is held in quarantine. */
  quarantined: boolean
  /** The stock writer of the direction in force is armed and allowed. */
  armed: boolean
}

/** Quarantine red, a failed write red, a difference waiting for the writer orange, applied or in step green. */
export function inventorySummary(rows: InventoryRows): SummaryDraft | undefined {
  if (rows.cards.length === 0 && rows.changes.length === 0 && rows.pushes.length === 0 && !rows.quarantined) return undefined
  const links = [deepLink.plans(null, rows.sku)]
  const waiting = [...rows.changes.filter((c) => c.status === "planned" || c.status === "over_cap"), ...rows.pushes.filter((p) => p.status === "planned" || p.status === "over_cap")]
  const failed = [...rows.changes.filter((c) => c.status === "failed"), ...rows.pushes.filter((p) => p.status === "failed")]
  const applied = rows.changes.some((c) => c.status === "applied") || rows.pushes.some((p) => p.status === "applied")

  let state: State
  let title: MessageDraft
  let detail: MessageDraft | undefined
  if (rows.quarantined) {
    state = "failed"
    title = m("inventory.quarantined")
    detail = m("product.quarantinedDetail")
    links.unshift(deepLink.plans("quarantined", rows.sku))
  } else if (failed.length > 0) {
    state = "failed"
    title = m("inventory.failed")
    links.unshift(deepLink.plans("failed", rows.sku))
  } else if (waiting.length > 0) {
    state = "attention"
    title = m("inventory.waiting")
    detail = rows.armed ? m("inventory.waitingArmed") : m("inventory.waitingNotArmed")
  } else if (applied) {
    state = "ok"
    title = m("inventory.applied")
  } else {
    state = "ok"
    title = m("inventory.inStep")
  }

  const facts: FactDraft[] = []
  const change = rows.changes[0]
  const push = rows.pushes[0]?.changes?.find((c) => c.field === "stock")
  const card = rows.cards[0]
  const stock = change ? change.bl_stock : push ? push.from : card?.stock
  if (stock !== null && stock !== undefined) {
    const fact: FactDraft = { slot: "stock", priority: 50, value: m("fact.stockBaseLinker", { stock: String(stock) }), tone: state === "failed" ? "red" : state === "attention" ? "orange" : "green", link: deepLink.plans(null, rows.sku) }
    if (change && change.medusa_stocked !== null && change.medusa_stocked !== undefined && (change.status === "planned" || change.status === "over_cap")) {
      fact.sub = m("fact.stockMedusa", { from: String(change.medusa_stocked), to: String(change.target) })
    } else if (!change && !push) fact.sub = m("fact.stockSame")
    facts.push(fact)
  }
  return {
    state,
    title,
    ...(detail ? { detail } : {}),
    facts,
    counts: { waiting: waiting.length, failed: failed.length },
    links,
    widget: null,
    updatedAt: latest(...rows.changes.map((c) => c.applied_at ?? c.created_at ?? null)),
  }
}

/* ------------------------------------------------------------------ */
/* Counters                                                            */
/* ------------------------------------------------------------------ */

export interface CounterCounts {
  ordersFailed: number
  importsFailed: number
  quarantined: number
  cardsConflict: number
  /** Up to 20 Medusa order ids of the failed sends, when they come with the count. */
  failedOrderIds?: string[]
}

/** The board counters, each opening the plugin page with a filter the page reads. */
export function baselinkerCounters(c: CounterCounts, scopes: readonly string[]): CounterDraft[] {
  const out: CounterDraft[] = []
  if (scopes.includes("orders")) {
    out.push({ key: "orders_failed", scope: "orders", count: c.ordersFailed, tone: "red", link: deepLink.orders("failed"), entity: "order", ...(c.failedOrderIds?.length ? { ids: c.failedOrderIds } : {}) })
    out.push({ key: "imports_failed", scope: "orders", count: c.importsFailed, tone: "red", link: deepLink.imports("failed"), entity: "order" })
  }
  if (scopes.includes("inventory")) out.push({ key: "quarantined", scope: "inventory", count: c.quarantined, tone: "red", link: deepLink.plans("quarantined"), entity: "inventory_item" })
  if (scopes.includes("products")) out.push({ key: "cards_conflict", scope: "products", count: c.cardsConflict, tone: "orange", link: deepLink.cards("conflicts"), entity: "product" })
  return out
}
