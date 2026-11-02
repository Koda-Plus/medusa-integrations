import { OPTION_SPECS, type OptionKind } from "./constants"
import type { CountsDto } from "./contract"
import { problemsOf, shipmentStageOf, waybillsOf, type ShipmentRow } from "./dto"
import type { CounterDraft, FactDraft, SummaryDraft } from "./kit-routes"

/**
 * DPD in the koda.integration/1 contract, as pure functions over the
 * plugin's own rows (testable without a database): one line per order, the
 * delivery and payment facts of the overview card, and the board counters.
 *
 * Every shipment of the order counts and the worst one speaks: red (refused,
 * an unclear answer, a delivery problem, a parcel coming back), then orange
 * (waits for a person), blue (under way), green (delivered). Nothing comes
 * from order metadata: the rows are the plugin's record, and the choice at
 * checkout comes from the shipping method data the DPD provider validated.
 *
 * Links are admin paths of the DPD page with a search (`/dpd?q=1042`) or a
 * filter (`/dpd?filter=problems`). Stage 1 links nowhere outside the admin.
 */

export const DPD_EXTERNAL_HOSTS: readonly string[] = []

/** What the checkout chose, read from the shipping method data (validated by the provider), before any fulfillment. */
export type ChosenDpd = {
  kind: OptionKind
  cod: boolean
  pudoId: string | null
  country: string | null
}

export type OrderSummaryContext = {
  /** The shipment writer is allowed and armed: pending rows will be created. */
  armed: boolean
  demo: boolean
  displayId: number | null
  /** Minor units as money in the answer's language, e.g. "129,00 zł". */
  money: (minor: number, currency: string) => string
}

type Draft = SummaryDraft & { rank: number }

const RANK = { failed: 0, attention: 1, active: 2, ok: 3, none: 4 } as const

const live = (r: ShipmentRow) => r.state !== "canceled" && r.state !== "skipped"

const kindOf = (r: ShipmentRow): OptionKind | null => OPTION_SPECS.find((s) => s.id === r.option_id)?.kind ?? null

const codOf = (r: ShipmentRow): boolean => OPTION_SPECS.find((s) => s.id === r.option_id)?.cod ?? false

const t = (key: string, params?: Record<string, string | number>) => ({ key: `integration.order.${key}`, ...(params ? { params } : {}) })

/** One shipment as a line: its state, title and rank (lower is worse). */
export function shipmentLine(row: ShipmentRow): Draft {
  const point = row.pudo_id ?? null
  switch (row.state) {
    case "canceled":
      return { state: "none", title: t("canceled"), rank: RANK.none }
    case "skipped":
      return { state: "none", title: t("skipped"), rank: RANK.none }
    case "failed":
      return { state: "failed", title: t("failed"), rank: RANK.failed }
    case "unknown":
    case "ambiguous":
    case "abandoned_unknown":
      return { state: "failed", title: t("unknown"), rank: RANK.failed }
  }
  const stage = shipmentStageOf(row.stage)
  if (stage === "problem") return { state: "failed", title: t("problem"), rank: RANK.failed }
  if (stage === "returned") return { state: "failed", title: t("returned"), rank: RANK.failed }
  if (stage === "canceled") return { state: "none", title: t("canceled"), rank: RANK.none }
  if (row.kind === "return") {
    if (stage === "delivered") return { state: "ok", title: t("returnDelivered"), rank: RANK.ok }
    if (row.state === "pending") return { state: "attention", title: t("returnToCreate"), rank: RANK.attention }
    return { state: "active", title: t("returnOnTheWay"), rank: RANK.active }
  }
  if (stage === "delivered") return { state: "ok", title: kindOf(row) === "pickup" ? t("collected") : t("delivered"), rank: RANK.ok }
  if (stage === "in_point") return { state: "active", title: point ? t("inPoint", { point }) : t("inTransit"), rank: RANK.active }
  if (stage === "in_transit") return { state: "active", title: t("inTransit"), rank: RANK.active }
  switch (row.state) {
    case "pending":
      if (problemsOf(row.problems).length > 0) return { state: "attention", title: t("planProblems"), rank: RANK.attention }
      return { state: "attention", title: point ? t("toCreateAt", { point }) : t("toCreate"), rank: RANK.attention }
    case "creating":
      return { state: "active", title: t("creating"), rank: RANK.active }
    case "created":
      return { state: "attention", title: t("toLabel"), rank: RANK.attention }
    case "labeling":
      return { state: "active", title: t("labeling"), rank: RANK.active }
  }
  /* labeled: the handover decides */
  if (row.handed_over_at) return { state: "active", title: t("handedOver"), rank: RANK.active }
  return { state: "active", title: t("labeled"), rank: RANK.active }
}

function deliveryFact(row: ShipmentRow | null, chosen: ChosenDpd | null, displayId: number | null): FactDraft | null {
  const kind = row ? (row.kind === "return" ? "return" : kindOf(row)) : (chosen?.kind ?? null)
  if (!kind) return null
  const point = row?.pudo_id ?? chosen?.pudoId ?? null
  const country = row?.country_code ?? chosen?.country ?? null
  let value: FactDraft["value"]
  if (kind === "pickup" && point) value = { key: "integration.fact.pickup", params: { point } }
  else if (kind === "return") value = { key: "integration.fact.return" }
  else if (kind === "courier" && country && country !== "PL") value = { key: "integration.fact.courierAbroad", params: { country } }
  else value = { key: "integration.fact.courier" }
  const fact: FactDraft = { slot: "delivery", priority: 80, value }
  const [waybill] = row ? waybillsOf(row.waybills) : []
  if (waybill) fact.sub = { key: "integration.fact.waybill", params: { number: waybill } }
  fact.link = { kind: "admin", href: displayId !== null ? `/dpd?q=${displayId}` : "/dpd" }
  return fact
}

function codFact(rows: ShipmentRow[], chosen: ChosenDpd | null, money: OrderSummaryContext["money"]): FactDraft | null {
  /* One shipment of the order carries the amount (D10); before it is created none has one. */
  const carriers = rows.filter((r) => live(r) && r.kind !== "return" && codOf(r))
  const carrier = carriers.find((r) => r.cod_minor !== null && r.cod_minor !== undefined) ?? carriers[0]
  if (!carrier && !(rows.length === 0 && chosen?.cod)) return null
  const minor = carrier?.cod_minor
  return {
    slot: "payment",
    /* The payment plugin that took the money online speaks louder (80); cash on delivery is what DPD knows. */
    priority: 50,
    code: "cod",
    tone: "blue",
    value:
      minor !== null && minor !== undefined
        ? { key: "integration.fact.codAmount", params: { amount: money(Number(minor), carrier?.currency || "PLN") } }
        : { key: "integration.fact.codLater" },
  }
}

const createdAt = (r: ShipmentRow): number => {
  const n = r.created_at ? new Date(r.created_at).getTime() : 0
  return Number.isFinite(n) ? n : 0
}

/** The line of one order from its rows (current mode) and the checkout's choice; undefined when DPD has nothing to say. */
export function orderSummary(rows: ShipmentRow[], chosen: ChosenDpd | null, ctx: OrderSummaryContext): SummaryDraft | undefined {
  const widget = "dpd.order"
  const links = [{ kind: "admin" as const, href: ctx.displayId !== null ? `/dpd?q=${ctx.displayId}` : "/dpd" }]
  if (rows.length === 0) {
    if (!chosen || chosen.kind === "return") return undefined
    const facts = [deliveryFact(null, chosen, ctx.displayId), codFact([], chosen, ctx.money)].filter((f): f is FactDraft => f !== null)
    return {
      state: "none",
      title: chosen.kind === "pickup" && chosen.pudoId ? t("chosenPickup", { point: chosen.pudoId }) : t("chosenCourier"),
      ...(ctx.demo ? { detail: t("demo") } : {}),
      facts,
      links,
      widget,
    }
  }

  const lines = rows.map((r) => ({ row: r, line: shipmentLine(r) }))
  const open = lines.filter((x) => live(x.row))
  const pool = open.length > 0 ? open : lines
  const worst = [...pool].sort((a, b) => a.line.rank - b.line.rank || createdAt(a.row) - createdAt(b.row) || a.row.id.localeCompare(b.row.id))[0]
  const delivered = open.filter((x) => x.line.state === "ok").length
  const counts = { shipments: open.length, delivered }

  let title = worst.line.title
  if (worst.line.state === "ok" && open.length > 1) title = t("deliveredSome", { done: delivered, total: open.length })
  let detail: SummaryDraft["detail"]
  if (worst.row.state === "pending" && !ctx.armed) detail = t("notArmed")
  else if (open.length > 1 && worst.line.state !== "ok") detail = t("more", { count: open.length - 1 })
  if (ctx.demo) detail = detail ?? t("demo")

  const facts = [deliveryFact(worst.row, chosen, ctx.displayId), codFact(rows, chosen, ctx.money)].filter((f): f is FactDraft => f !== null)
  const updated = rows
    .map((r) => (r.last_checked_at ? new Date(r.last_checked_at).getTime() : 0))
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

/** Board counters from the counts of the current mode (the same counts as the Panel's filter buttons). */
export function dpdCounters(counts: Pick<CountsDto, "problems" | "to_create" | "labeled">): CounterDraft[] {
  return [
    { key: "shipments_problems", scope: "orders", count: counts.problems, tone: "red", link: { kind: "admin", href: "/dpd?filter=problems" }, entity: "order" },
    { key: "shipments_to_create", scope: "orders", count: counts.to_create, tone: "orange", link: { kind: "admin", href: "/dpd?filter=to_create" }, entity: "order" },
    { key: "shipments_labeled", scope: "orders", count: counts.labeled, tone: "blue", link: { kind: "admin", href: "/dpd?filter=labeled" }, entity: "order" },
  ]
}
