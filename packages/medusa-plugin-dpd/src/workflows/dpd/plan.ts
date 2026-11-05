/**
 * THE PLAN OF A ROW: what goes to DPD when a person confirms, built from the
 * row and the order as it is now (lib/plan.ts does the mapping). The
 * receiver is read live from the order and only goes to the request and to
 * the no-store answer of the plan route; the row keeps the problem codes
 * only, so the Panel lists them without building plans.
 *
 * The Pickup point of a row is read fresh for every plan (no cache): the
 * plan says what the point is now, and a point that could not be read is a
 * warning, not a problem (DPD checks it when the shipment is created).
 *
 * A read of the point can be slow, and the point or the boxes can change
 * while it waits (POST point, POST boxes). Every write of problems therefore
 * expects the row still to have the point and the boxes its plan was built
 * from (planInputsOf); a row that changed meanwhile keeps what its own change
 * wrote.
 */

import { OPTION_SPECS } from "../../modules/dpd/lib/constants"
import type { ProblemDto } from "../../modules/dpd/lib/contract"
import { readStoredBoxes, type PlanBox, type StoredBoxes } from "../../modules/dpd/lib/boxes"
import { problemsOf, type ShipmentRow } from "../../modules/dpd/lib/dto"
import type { TransitionExpect } from "../../modules/dpd/lib/store"
import { isPudoId } from "../../modules/dpd/lib/option-data"
import { buildPlan, type Plan, type PlanRow } from "../../modules/dpd/lib/plan"
import type { PointCheck } from "../../modules/dpd/lib/points"
import { ActionError, dpdService, errorText, getShipmentOfMode, listShipments, loadOrder, pointsFor, recordEvent, storeFor, type OrderRecord, type Scope } from "./runtime"

export function planRowOf(row: ShipmentRow, order: OrderRecord | null): PlanRow {
  const f = row.fulfillment_id ? (order?.fulfillments ?? []).find((x) => x.id === row.fulfillment_id) ?? null : null
  return {
    id: row.id,
    kind: row.kind === "return" ? "return" : "outbound",
    optionId: row.option_id,
    pudoId: row.pudo_id ?? null,
    reference: row.reference ?? null,
    boxes: readStoredBoxes(row.boxes),
    fulfillment: f
      ? {
          id: f.id,
          canceledAt: f.canceled_at ?? null,
          shippedAt: f.shipped_at ?? null,
          deliveredAt: f.delivered_at ?? null,
          locationId: f.location_id ?? null,
          items: Array.isArray(f.items) ? f.items : null,
        }
      : null,
  }
}

function isCodOption(optionId: string): boolean {
  return OPTION_SPECS.find((s) => s.id === optionId)?.cod === true
}

/** States in which the cash on delivery went (or may have gone) to DPD with this row. */
const CARRYING: readonly string[] = ["creating", "created", "labeling", "labeled", "unknown", "ambiguous"]
/** States of a row that no longer ships. */
const NOT_SHIPPING: readonly string[] = ["canceled", "skipped", "abandoned_unknown"]

/**
 * The id of the row of this order that carries cash on delivery, or null for
 * a row without it. The buyer pays once: the first cash on delivery row that
 * already went to DPD with an amount carries it; before any did, the oldest
 * one that still ships; a row alone carries its own.
 */
export async function codCarrierOf(scope: Scope, row: ShipmentRow): Promise<string | null> {
  if (!isCodOption(row.option_id)) return null
  if (!row.order_id) return row.id
  const svc = dpdService(scope)
  const all = await listShipments(svc, { order_id: row.order_id, mode: row.mode }, { take: 100, order: { created_at: "ASC", id: "ASC" } })
  const siblings = all.filter((r) => r.kind !== "return" && isCodOption(r.option_id) && !NOT_SHIPPING.includes(r.state))
  const carrying = siblings.find((r) => CARRYING.includes(r.state) && r.cod_minor !== null && r.cod_minor !== undefined)
  return carrying?.id ?? siblings[0]?.id ?? row.id
}

/**
 * A Pickup row: pointsFor(scope).details(row.pudo_id), fresh. Courier and
 * return rows: undefined. A row without a valid id: undefined (the plan gives
 * pudo_missing or pudo_invalid). Never throws: a source that throws is an
 * unchecked point (network), logged masked.
 */
export async function pointCheckOf(scope: Scope, row: ShipmentRow): Promise<PointCheck | undefined> {
  const spec = OPTION_SPECS.find((s) => s.id === row.option_id)
  if (!spec || spec.kind !== "pickup" || row.kind === "return") return undefined
  const pudoId = row.pudo_id ?? ""
  if (!pudoId || !isPudoId(pudoId)) return undefined
  try {
    return await pointsFor(scope).details(pudoId)
  } catch (err) {
    const svc = dpdService(scope)
    svc.getLogger().warn(`[dpd] Could not read Pickup point ${pudoId} for ${row.id}: ${errorText(svc, err)}`)
    return { status: "unchecked", pudoId, reason: "network" }
  }
}

/** The plan of a row now. `point`: the check changePoint already made (one read per change); otherwise pointCheckOf reads it (only when the order is there: without it the plan stops before the point). */
export async function planOf(scope: Scope, row: ShipmentRow, point?: PointCheck): Promise<{ plan: Plan; order: OrderRecord | null }> {
  const svc = dpdService(scope)
  const order = row.order_id ? await loadOrder(scope, row.order_id) : null
  const carrier = await codCarrierOf(scope, row)
  const check = point ?? (order ? await pointCheckOf(scope, row) : undefined)
  const plan = buildPlan(planRowOf(row, order), order, {
    options: svc.getOptions(),
    demo: svc.isDemo(),
    codCarrier: carrier === null ? undefined : carrier === row.id,
    ...(check ? { point: check } : {}),
  })
  return { plan, order }
}

const sameProblems = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** What a write built from the plan of `row` expects the row still to hold: the point and the boxes that plan read. */
export function planInputsOf(row: Pick<ShipmentRow, "pudo_id" | "boxes">): TransitionExpect {
  return { pudo_id: row.pudo_id ?? null, boxes: row.boxes ?? null }
}

/** Whether two reads of a row have the same plan inputs (the point and the boxes of planInputsOf). */
export function samePlanInputs(a: Pick<ShipmentRow, "pudo_id" | "boxes">, b: Pick<ShipmentRow, "pudo_id" | "boxes">): boolean {
  return (a.pudo_id ?? null) === (b.pudo_id ?? null) && JSON.stringify(a.boxes ?? null) === JSON.stringify(b.boxes ?? null)
}

/**
 * failed: keep the stored problems DPD gave at the last attempt (dpd_*, and
 * the Pickup ones with source "dpd") next to the plan problems, deduplicated
 * by code and field; a "dpd" problem the plan finds itself (same code, any
 * field) is left out. `dropPointAnswers` (a point change) leaves out the
 * stored pudo_* answers of DPD: they were about the old point. Otherwise the
 * plan problems. Null when none.
 */
export function mergeProblems(planProblems: ProblemDto[], stored: unknown, state: string, opts: { dropPointAnswers?: boolean } = {}): ProblemDto[] | null {
  const out: ProblemDto[] = [...planProblems]
  if (state === "failed") {
    for (const p of problemsOf(stored)) {
      const fromDpd = p.source === "dpd"
      if (!p.code.startsWith("dpd_") && !fromDpd) continue
      if (fromDpd && opts.dropPointAnswers && p.code.startsWith("pudo_")) continue
      if (fromDpd && planProblems.some((q) => q.code === p.code)) continue
      if (out.some((q) => q.code === p.code && (q.field ?? null) === (p.field ?? null))) continue
      out.push(p)
    }
  }
  return out.length > 0 ? out : null
}

/**
 * GET plan: pending | failed only (409 wrong_state otherwise); stores the
 * problems when they changed (mergeProblems). A row whose point or boxes
 * changed while the plan was read is read again once: that plan was about
 * what the row was. A row that moved on (claimed meanwhile) answers the plan
 * read, as before.
 */
export async function planForShipment(scope: Scope, id: string): Promise<{ row: ShipmentRow; plan: Plan }> {
  return planOnce(scope, id, true)
}

async function planOnce(scope: Scope, id: string, again: boolean): Promise<{ row: ShipmentRow; plan: Plan }> {
  const svc = dpdService(scope)
  const row = await getShipmentOfMode(svc, id)
  if (!row) throw new ActionError(404, "not_found", "No DPD shipment with this id in the current mode.")
  if (row.state !== "pending" && row.state !== "failed") throw new ActionError(409, "wrong_state", `The shipment is ${row.state}: a plan is read only before it is created.`)
  const { plan } = await planOf(scope, row)
  const problems = mergeProblems(plan.problems, row.problems, row.state)
  if (!sameProblems(problems, row.problems)) {
    const moved = await storeFor(scope).transition(row.id, [row.state], { problems }, planInputsOf(row))
    if (moved) return { row: moved, plan }
    const now = again ? await getShipmentOfMode(svc, id) : null
    if (now && (now.state === "pending" || now.state === "failed")) return planOnce(scope, id, false)
  }
  return { row, plan }
}

/** After recording or an edit: the plan problems on a pending | failed row. Never throws (logs masked). */
export async function refreshProblems(scope: Scope, row: ShipmentRow): Promise<ShipmentRow> {
  if (row.state !== "pending" && row.state !== "failed") return row
  const svc = dpdService(scope)
  try {
    const { plan } = await planOf(scope, row)
    const problems = mergeProblems(plan.problems, row.problems, row.state)
    if (sameProblems(problems, row.problems)) return row
    const moved = await storeFor(scope).transition(row.id, [row.state], { problems }, planInputsOf(row))
    /* Not written: the row moved on or its point or boxes changed meanwhile; what it holds now is the answer. */
    return moved ?? (await getShipmentOfMode(svc, row.id)) ?? row
  } catch (err) {
    svc.getLogger().warn(`[dpd] Could not build the plan of ${row.id}: ${errorText(svc, err)}`)
    return row
  }
}

/**
 * POST boxes: pending | failed; null resets to automatic. Writes boxes =
 * { edited: true, items } (or the last snapshot with edited false) and the
 * new problems in one transition, then returns the fresh plan.
 */
export async function setBoxes(scope: Scope, id: string, boxes: PlanBox[] | null, actor: string | null): Promise<{ row: ShipmentRow; plan: Plan }> {
  const svc = dpdService(scope)
  const row = await getShipmentOfMode(svc, id)
  if (!row) throw new ActionError(404, "not_found", "No DPD shipment with this id in the current mode.")
  if (row.state !== "pending" && row.state !== "failed") throw new ActionError(409, "wrong_state", `The shipment is ${row.state}: boxes change only before it is created.`)
  const stored = readStoredBoxes(row.boxes)
  const next: StoredBoxes | null = boxes
    ? { edited: true, items: boxes.map((b) => ({ weightKg: b.weightKg, lengthCm: b.lengthCm, widthCm: b.widthCm, heightCm: b.heightCm, reference: null, waybill: null })) }
    : stored
      ? { edited: false, items: stored.items }
      : null
  const draft: ShipmentRow = { ...row, boxes: next }
  const { plan } = await planOf(scope, draft)
  const problems = mergeProblems(plan.problems, row.problems, row.state)
  const moved = await storeFor(scope).transition(row.id, [row.state], { boxes: next, problems }, planInputsOf(row))
  if (!moved) throw new ActionError(409, "wrong_state", "The shipment changed a moment ago (its state, point or boxes); read it again.")
  await recordEvent(scope, {
    shipment_id: row.id,
    order_id: row.order_id,
    kind: "action",
    source: actor ? "admin" : "system",
    actor,
    message: boxes ? `Boxes set by hand: ${boxes.length}.` : "Boxes back to automatic.",
    data: { action: "boxes_changed", boxes: boxes ? boxes.length : null, edited: Boolean(boxes) },
    mode: svc.mode(),
  })
  return { row: moved, plan }
}
