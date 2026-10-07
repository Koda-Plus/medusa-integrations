import type { ParcelRow } from "./dto"
import type { CounterDraft, FactDraft, SummaryDraft } from "./kit-routes"
import { shipmentStage, trackingUrl } from "./statuses"

/**
 * InPost in the koda.integration/1 contract, as pure functions over the
 * plugin's own rows (testable without a database): one line per order, the
 * delivery and payment facts of the overview card, and the board counters.
 *
 * Every parcel of the order counts and the worst one speaks: red (not
 * created, a delivery problem, a return), then orange (waits for a person),
 * blue (under way), green (delivered). Nothing comes from order metadata:
 * the rows are the plugin's record, and the choice at checkout comes from
 * the shipping method data the InPost provider validated.
 */

export const INPOST_EXTERNAL_HOSTS = ["inpost.pl"] as const

/** What the checkout chose, read from the shipping method data (validated by the provider), before any fulfillment. */
export interface ChosenInpost {
  kind: "locker" | "courier"
  cod: boolean
  locker: string | null
}

export interface OrderSummaryContext {
  /** The shipment writer is allowed and armed: pending rows will be created. */
  armed: boolean
  demo: boolean
  displayId: number | null
  /** Grosze as money in the answer's language, e.g. "129,00 zł". */
  money: (minor: number) => string
}

type Draft = SummaryDraft & { rank: number }

const RANK = { failed: 0, attention: 1, active: 2, ok: 3, none: 4 } as const

const live = (r: ParcelRow) => r.state !== "canceled" && r.state !== "skipped"

/** One parcel as a line: its state, title and rank (lower is worse). */
export function parcelLine(row: ParcelRow): Draft {
  const locker = row.kind === "locker" ? row.locker_code : null
  const t = (key: string, params?: Record<string, string | number>) => ({ key: `integration.order.${key}`, params })
  switch (row.state) {
    case "failed":
      return { state: "failed", title: t("failed"), rank: RANK.failed }
    case "unknown":
      return { state: "failed", title: t("unknown"), rank: RANK.failed }
    case "creating":
      return { state: "active", title: t("creating"), rank: RANK.active }
    case "pending":
      if (row.problems && row.problems.length > 0) return { state: "attention", title: t("planProblems"), rank: RANK.attention }
      return { state: "attention", title: locker ? t("toCreateAt", { locker }) : t("toCreate"), rank: RANK.attention }
    case "skipped":
      return { state: "none", title: t("skipped"), rank: RANK.none }
    case "canceled":
      return { state: "none", title: t("canceled"), rank: RANK.none }
  }
  /* created: the ShipX status decides */
  const stage = shipmentStage(row.status)
  if (row.status === "offers_prepared") return { state: "attention", title: t("awaitingPayment"), rank: RANK.attention }
  switch (stage) {
    case "problem":
      return { state: "failed", title: t("problem"), rank: RANK.failed }
    case "returned":
      return { state: "failed", title: t("returned"), rank: RANK.failed }
    case "canceled":
      return row.fulfillment_canceled_at ? { state: "none", title: t("canceled"), rank: RANK.none } : { state: "attention", title: t("canceledOpen"), rank: RANK.attention }
    case "preparing":
    case "ready":
      return { state: "active", title: t("waiting"), rank: RANK.active }
    case "in_transit":
      return { state: "active", title: t("inTransit"), rank: RANK.active }
    case "in_locker":
      return { state: "active", title: locker ? t("inLocker", { locker }) : t("inPoint"), rank: RANK.active }
    case "delivered":
      return { state: "ok", title: t("delivered"), rank: RANK.ok }
  }
  return { state: "active", title: t("inTransit"), rank: RANK.active }
}

function deliveryFact(row: ParcelRow | null, chosen: ChosenInpost | null, displayId: number | null): FactDraft | null {
  const kind = row ? (row.kind === "courier" ? "courier" : "locker") : chosen?.kind
  if (!kind) return null
  const locker = row?.locker_code ?? chosen?.locker ?? null
  const fact: FactDraft = {
    slot: "delivery",
    priority: 80,
    value: kind === "locker" && locker ? { key: "integration.fact.locker", params: { locker } } : { key: "integration.fact.courier" },
  }
  if (row?.tracking_number) {
    fact.sub = { key: "integration.fact.tracking", params: { number: row.tracking_number } }
    if (!row.demo) fact.link = { kind: "external", href: trackingUrl(row.tracking_number) }
  }
  if (!fact.link && displayId !== null) fact.link = { kind: "admin", href: `/inpost?q=${displayId}` }
  return fact
}

function codFact(rows: ParcelRow[], chosen: ChosenInpost | null, money: (minor: number) => string): FactDraft | null {
  const carrier = rows.filter(live).find((r) => r.cod)
  if (!carrier && !(rows.length === 0 && chosen?.cod)) return null
  const minor = carrier?.cod_minor
  return {
    slot: "payment",
    /* The payment plugin that took the money online speaks louder (80); cash on delivery is what InPost knows. */
    priority: 50,
    tone: "blue",
    value:
      minor !== null && minor !== undefined
        ? { key: "integration.fact.codAmount", params: { amount: money(Number(minor)) } }
        : { key: "integration.fact.codLater" },
  }
}

/** The line of one order from its rows (current mode) and the checkout's choice. */
export function orderSummary(rows: ParcelRow[], chosen: ChosenInpost | null, ctx: OrderSummaryContext): SummaryDraft | undefined {
  const widget = "inpost.order"
  const links = ctx.displayId !== null ? [{ kind: "admin" as const, href: `/inpost?q=${ctx.displayId}` }] : [{ kind: "admin" as const, href: "/inpost" }]
  if (rows.length === 0) {
    if (!chosen) return undefined
    const facts = [deliveryFact(null, chosen, ctx.displayId), codFact([], chosen, ctx.money)].filter((f): f is FactDraft => f !== null)
    return {
      state: "none",
      title: chosen.kind === "locker" && chosen.locker ? { key: "integration.order.chosenLocker", params: { locker: chosen.locker } } : { key: "integration.order.chosenCourier" },
      facts,
      links,
      widget,
    }
  }

  const lines = rows.map((r) => ({ row: r, line: parcelLine(r) }))
  const open = lines.filter((x) => live(x.row))
  const pool = open.length > 0 ? open : lines
  const worst = [...pool].sort((a, b) => a.line.rank - b.line.rank || (a.row.parcel_no ?? 0) - (b.row.parcel_no ?? 0))[0]
  const delivered = open.filter((x) => x.line.state === "ok").length
  const counts = { parcels: open.length, delivered }

  let title = worst.line.title
  if (worst.line.state === "ok" && open.length > 1) title = { key: "integration.order.deliveredSome", params: { done: delivered, total: open.length } }
  let detail: SummaryDraft["detail"]
  if (worst.row.state === "pending" && !ctx.armed) detail = { key: "integration.order.notArmed" }
  else if (open.length > 1 && worst.line.state !== "ok") detail = { key: "integration.order.more", params: { count: open.length - 1 } }
  if (ctx.demo) detail = detail ?? { key: "integration.order.demo" }

  const facts = [deliveryFact(worst.row, chosen, ctx.displayId), codFact(rows, chosen, ctx.money)].filter((f): f is FactDraft => f !== null)
  const updated = rows
    .map((r) => (r.status_at ? new Date(r.status_at).getTime() : 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a)[0]

  return {
    state: worst.line.state,
    title,
    ...(detail ? { detail } : {}),
    facts,
    counts,
    links,
    widget,
    updatedAt: updated ? new Date(updated) : null,
  }
}

/** Board counters from the grouped counts of the current mode. */
export function inpostCounters(counts: { toCreate: number; failed: number; problems: number; awaitingPayment: number }): CounterDraft[] {
  return [
    { key: "parcels_failed", scope: "orders", count: counts.failed, tone: "red", link: { kind: "admin", href: "/inpost?filter=to_create" }, entity: "order" },
    { key: "parcels_problems", scope: "orders", count: counts.problems, tone: "red", link: { kind: "admin", href: "/inpost?filter=problems" }, entity: "order" },
    { key: "parcels_to_create", scope: "orders", count: counts.toCreate, tone: "orange", link: { kind: "admin", href: "/inpost?filter=to_create" }, entity: "order" },
    { key: "parcels_awaiting_payment", scope: "orders", count: counts.awaitingPayment, tone: "orange", link: { kind: "admin", href: "/inpost?filter=waiting" }, entity: "order" },
  ]
}
