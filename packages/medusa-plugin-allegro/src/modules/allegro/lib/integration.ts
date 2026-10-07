import { offerUrl, type AllegroEnvironment } from "./constants"
import type { ImportRow, OfferRow } from "./dto"
import type { CounterDraft, FactDraft, LinkDraft, SummaryDraft } from "./kit-routes"
import { statusGroup } from "./matching"
import { STOCK_ISSUES } from "./stock"

/**
 * Allegro in the koda.integration/1 contract, as pure functions over the
 * plugin's own rows (testable without a database).
 *
 * ORDERS: only orders this plugin imported have a line. Ownership is the
 * import row that names the order in `order_id` (a duplicate of another
 * integration's order never does); nothing comes from order metadata. The
 * row speaks: a total that differs or a change on Allegro after the import
 * is red, a held import orange, an import under way blue, an imported order
 * green, a cancelled one grey. The facts: the channel (Allegro, the buyer
 * login), the payment (cash on delivery or paid on Allegro), the delivery
 * method with the pickup point, and the buyer login, all from the row.
 *
 * PRODUCTS AND VARIANTS: the offers linked to them, the worst speaks: a
 * stock problem (Allegro sells more than Medusa has, or a live offer of a
 * sold out variant) is orange, a live offer green, drafts and ended offers
 * grey. The listing fact links the offer on allegro.pl (the sandbox host in
 * sandbox mode); demo offers link the plugin page instead.
 */

export const ALLEGRO_EXTERNAL_HOSTS = ["allegro.pl", "allegro.pl.allegrosandbox.pl"] as const

type Draft = SummaryDraft & { rank: number }

const RANK = { failed: 0, attention: 1, active: 2, ok: 3, none: 4 } as const

const m = (key: string, params?: Record<string, string | number>) => ({ key: `integration.${key}`, ...(params ? { params } : {}) })

/** The plugin page with a list filter and a search, as the page reads them. */
export function pageLink(filter: string, q?: string | null): LinkDraft {
  const params = new URLSearchParams({ filter })
  if (q) params.set("q", q)
  return { kind: "admin", href: `/allegro?${params.toString()}` }
}

/** An import row that names one of OUR orders (not another integration's duplicate). */
export function ownsOrder(row: Pick<ImportRow, "order_id" | "reason_code">): boolean {
  return Boolean(row.order_id) && row.reason_code !== "duplicate_ref"
}

function detailsOf(row: ImportRow): Record<string, unknown> {
  return row.details && typeof row.details === "object" ? row.details : {}
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null
}

function moneyValue(v: unknown): { value: number; currency: string } | null {
  const o = v && typeof v === "object" ? (v as { value?: unknown; currency?: unknown }) : null
  const value = Number(o?.value)
  return o && Number.isFinite(value) && typeof o.currency === "string" ? { value, currency: o.currency } : null
}

/** The line of one import row: state, title, rank (lower is worse) and the list filter that shows it. */
export function importLine(row: ImportRow): Draft & { filter: string } {
  if (row.attention) return { state: "failed", title: m("order.attention"), detail: m("order.attentionHint"), rank: RANK.failed, filter: "attention" }
  if (row.total_mismatch) return { state: "failed", title: m("order.mismatch"), rank: RANK.failed, filter: "attention" }
  switch (row.status) {
    case "held":
      return { state: "attention", title: m("order.held"), detail: m("order.heldReason"), rank: RANK.attention, filter: "held" }
    case "pending":
    case "unknown":
    case "importing":
      return { state: "active", title: m("order.importing"), rank: RANK.active, filter: "pending" }
    case "imported":
      return { state: "ok", title: m("order.imported"), rank: RANK.ok, filter: "imported" }
    case "cancelled":
      return { state: "none", title: m("order.cancelled"), rank: RANK.none, filter: "cancelled" }
    default:
      return { state: "none", title: m("order.skipped"), rank: RANK.none, filter: "skipped" }
  }
}

export interface OrderSummaryContext {
  demo: boolean
  /** Major units as money in the answer's language, e.g. "129,00 zł". */
  money: (amount: number, currency: string) => string
}

/** The facts of an imported order, from its import row only; links open that row in the list that shows it. */
export function orderFacts(row: ImportRow): FactDraft[] {
  const d = detailsOf(row)
  const login = text(d.buyer_login)
  const facts: FactDraft[] = []
  const link = pageLink(importLine(row).filter, row.checkout_form_id)
  facts.push({
    slot: "channel",
    priority: 80,
    code: "allegro",
    value: m("fact.channel"),
    ...(login ? { sub: m("fact.login", { login }) } : {}),
    link,
  })
  if (row.payment_type === "CASH_ON_DELIVERY") {
    facts.push({ slot: "payment", priority: 70, code: "cod", tone: "blue", value: m("fact.cod") })
  } else if (row.paid) {
    facts.push({ slot: "payment", priority: 70, code: "paid", tone: "green", value: m("fact.paid") })
  } else if (row.payment_type) {
    facts.push({ slot: "payment", priority: 70, code: "pending", tone: "orange", value: m("fact.pending") })
  }
  const method = text(d.delivery_method)
  const point = text(d.pickup_point_id) ?? text(d.pickup_point_name)
  if (method || point) {
    facts.push({
      slot: "delivery",
      /* InPost's own parcel fact (80) wins in a host; this is what the buyer chose on Allegro. */
      priority: 60,
      value: method ? m("fact.delivery", { method }) : m("fact.deliveryAllegro"),
      ...(point ? { sub: m("fact.point", { point }) } : {}),
    })
  }
  if (login) facts.push({ slot: "buyer", priority: 60, value: m("fact.login", { login }), link })
  return facts
}

/** The line of one Medusa order from the import rows that name it (current mode). Undefined: not an order this plugin imported. */
export function orderSummary(rows: readonly ImportRow[], ctx: OrderSummaryContext): SummaryDraft | undefined {
  const own = rows.filter(ownsOrder)
  if (own.length === 0) return undefined
  const lines = own.map((row) => ({ row, line: importLine(row) }))
  const worst = [...lines].sort((a, b) => a.line.rank - b.line.rank || String(a.row.checkout_form_id).localeCompare(String(b.row.checkout_form_id)))[0]
  const { row, line } = worst
  let detail = line.detail
  if (row.total_mismatch && !row.attention) {
    const allegro = moneyValue(row.total)
    const medusa = moneyValue(row.medusa_total)
    if (allegro && medusa) detail = m("order.mismatchAmounts", { allegro: ctx.money(allegro.value, allegro.currency), medusa: ctx.money(medusa.value, medusa.currency) })
  }
  if (!detail && ctx.demo) detail = m("order.demo")
  const updated = row.updated_at ?? row.imported_at ?? null
  return {
    state: line.state,
    title: line.title,
    ...(detail ? { detail } : {}),
    facts: orderFacts(row),
    counts: { lines: Number(row.line_count) || 0 },
    links: [pageLink(line.filter, row.checkout_form_id)],
    widget: "allegro.order",
    updatedAt: updated ? new Date(updated) : null,
  }
}

/* ------------------------------------------------------------------ */
/* Products and variants                                               */
/* ------------------------------------------------------------------ */

function offerLine(o: OfferRow): Draft {
  /* The same offers the stock problem counter and the page's "stock" filter count. */
  if (o.stock_state === "sold_out") return { state: "attention", title: m("product.soldOut"), rank: RANK.attention }
  if (STOCK_ISSUES.includes(o.stock_state as never)) return { state: "attention", title: m("product.oversell"), rank: RANK.attention }
  const group = statusGroup(o.status)
  if (group === "live" || group === "activating") return { state: "ok", title: m("product.live", { count: 1 }), rank: RANK.ok }
  if (group === "draft") return { state: "none", title: m("product.drafts"), rank: RANK.none }
  return { state: "none", title: m("product.ended"), rank: RANK.none }
}

function listingFact(o: OfferRow, env: AllegroEnvironment): FactDraft {
  const group = statusGroup(o.status)
  const quantity = typeof o.available === "number" && Number.isFinite(o.available) ? o.available : null
  const value =
    group === "live" || group === "activating"
      ? quantity !== null
        ? m("fact.listingLive", { quantity })
        : m("fact.listingLiveNoQty")
      : group === "draft"
        ? m("fact.listingDraft")
        : group === "ended"
          ? m("fact.listingEnded")
          : m("fact.listingOther", { status: String(o.status ?? "") })
  const problem = STOCK_ISSUES.includes(o.stock_state as never)
  return {
    slot: "listing",
    /* The record of its own offers; a mirror (BaseLinker) would say 50. */
    priority: 70,
    value,
    sub: m("fact.offer", { id: o.allegro_id }),
    tone: problem ? "orange" : group === "live" || group === "activating" ? "green" : "grey",
    link: o.demo ? pageLink(problem ? "stock" : "all", o.allegro_id) : { kind: "external", href: offerUrl(env, o.allegro_id) },
  }
}

export interface ProductSummaryContext {
  demo: boolean
  environment: AllegroEnvironment
}

/** The line of one product or variant from its linked offers (current mode). Undefined: no offer is linked. */
export function offersSummary(offers: readonly OfferRow[], ctx: ProductSummaryContext): SummaryDraft | undefined {
  if (offers.length === 0) return undefined
  const lines = offers.map((o) => ({ o, line: offerLine(o) }))
  const sorted = [...lines].sort((a, b) => a.line.rank - b.line.rank || Number(b.o.is_primary) - Number(a.o.is_primary) || a.o.allegro_id.localeCompare(b.o.allegro_id))
  const worst = sorted[0]
  const live = lines.filter((x) => {
    const g = statusGroup(x.o.status)
    return g === "live" || g === "activating"
  }).length
  let title = worst.line.title
  if (worst.line.state === "ok") title = m("product.live", { count: live })
  let detail: SummaryDraft["detail"]
  if (worst.line.state === "none" && worst.o.stock_state === "ended_in_stock") detail = m("product.endedInStock")
  else if (offers.length > 1 && worst.line.state !== "ok") detail = m("product.more", { count: offers.length - 1 })
  if (!detail && ctx.demo) detail = m("product.demo")
  const problem = worst.line.state === "attention"
  const updated = offers
    .map((o) => (o.updated_at ? new Date(o.updated_at).getTime() : 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a)[0]
  return {
    state: worst.line.state,
    title,
    ...(detail ? { detail } : {}),
    facts: [listingFact(worst.o, ctx.environment)],
    counts: { offers: offers.length, live },
    links: [pageLink(problem ? "stock" : "all", offers.length === 1 ? worst.o.allegro_id : (worst.o.sku ?? worst.o.allegro_id))],
    widget: "allegro.product",
    updatedAt: updated ? new Date(updated) : null,
  }
}

/* ------------------------------------------------------------------ */
/* Board counters                                                      */
/* ------------------------------------------------------------------ */

export interface AllegroCounts {
  held: number
  attention: number
  stockProblems: number
  issuesOpen: number
}

/** Board counters of the current mode, every link opening the list it counts. */
export function allegroCounters(c: AllegroCounts): CounterDraft[] {
  return [
    { key: "imports_attention", scope: "orders", count: c.attention, tone: "red", link: pageLink("attention"), entity: "order" },
    { key: "imports_held", scope: "orders", count: c.held, tone: "orange", link: pageLink("held"), entity: "order" },
    { key: "issues_open", scope: "orders", count: c.issuesOpen, tone: "orange", link: pageLink("issues"), entity: "order" },
    { key: "offers_stock_problem", scope: "products", count: c.stockProblems, tone: "orange", link: pageLink("stock"), entity: "product" },
  ]
}
