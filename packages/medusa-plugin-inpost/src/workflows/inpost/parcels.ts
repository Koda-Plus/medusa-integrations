/**
 * THE SHIPMENTS: recording a fulfillment, the plan, creating a shipment
 * exactly once, statuses, the follow ups of a status (events, a prepaid
 * offer, the Medusa fulfillment), cancelling, labels, the courier pickup and
 * the edits a person makes before anything is sent.
 *
 * EXACTLY ONCE. A shipment is created only from a row in `pending`, claimed
 * by one statement (pending to creating, with a token and a lease); the
 * request goes out once; only the claim's owner writes the result. An answer
 * that never came leaves the row `unknown`: the next status pass looks the
 * shipment up in ShipX (receiver and reference) before a person may send it
 * again. The database itself refuses a second row for one fulfillment.
 *
 * WRITES ONLY WHEN ARMED. Creating, paying a prepaid offer, a courier pickup
 * and cancelling need the shipment writer allowed in the options and armed in
 * Settings; marking the Medusa fulfillment shipped or delivered needs the
 * fulfillment status writer. Everything else (the plan, statuses, labels,
 * the locker of a shipment not yet sent) works without them.
 */

import { randomUUID } from "node:crypto"
import { CREATE_LEASE_MS, UNKNOWN_SETTLE_MS, type LabelSize, type ParcelSize } from "../../modules/inpost/lib/constants"
import type { ShipxOffer, ShipxShipment } from "../../modules/inpost/lib/client"
import { demoNextStatus, demoShipmentId, demoTrackingNumber, searchDemoPoints } from "../../modules/inpost/lib/demo"
import type { ParcelRow } from "../../modules/inpost/lib/dto"
import { describeError, InpostApiError } from "../../modules/inpost/lib/errors"
import { createdEvents, statusEvents, type EventSourceRow } from "../../modules/inpost/lib/events"
import { externalShipmentId, shippedOutsideKey } from "../../modules/inpost/lib/guards"
import { isLockerCode, normalizeLockerCode } from "../../modules/inpost/lib/lockers"
import { formatMinor } from "../../modules/inpost/lib/money"
import { canCallShipx } from "../../modules/inpost/lib/options"
import { readFulfillmentData } from "../../modules/inpost/lib/option-data"
import { labelFileName, simpleLabelPdf } from "../../modules/inpost/lib/pdf"
import { buildPlan, type Plan, type PlanRow } from "../../modules/inpost/lib/plan"
import { fetchPoints, pointsParams, type PointDto } from "../../modules/inpost/lib/points"
import { isCancellable, isLabelAvailable, needsPayment, trackingUrl } from "../../modules/inpost/lib/statuses"
import type { ParcelPatch } from "../../modules/inpost/lib/store"
import { normalizePhone } from "../../modules/inpost/lib/address"
import { Modules } from "@medusajs/framework/utils"
import {
  ActionError,
  clientFor,
  emitEvent,
  getParcel,
  getParcelOfMode,
  inBackground,
  inpostService,
  isArmed,
  isInpostProvider,
  listParcels,
  loadOrder,
  recordEvent,
  resolveOptional,
  settingsOf,
  storeFor,
  type OrderRecord,
  type Scope,
} from "./runtime"
import { syncFulfillmentStatus } from "./status-writer"

export type Trigger = "manual" | "auto" | "schedule" | "webhook"

const now = () => new Date()

function eventSource(row: ParcelRow): EventSourceRow {
  return {
    id: row.id,
    order_id: row.order_id,
    fulfillment_id: row.fulfillment_id,
    shipment_id: row.shipment_id,
    tracking_number: row.tracking_number,
    status: row.status,
    service: row.service,
    kind: row.kind,
    locker_code: row.locker_code,
    locker_name: row.locker_name,
    locker_address: row.locker_address,
    cod: Boolean(row.cod),
    cod_amount: row.cod_minor === null || row.cod_minor === undefined ? null : formatMinor(Number(row.cod_minor)),
    demo: Boolean(row.demo),
  }
}

async function emitAll(scope: Scope, events: Array<{ name: string; data: object }>): Promise<void> {
  for (const e of events) await emitEvent(scope, e.name, e.data as Record<string, unknown>)
}

function mustFind(row: ParcelRow | null): ParcelRow {
  if (!row) throw new ActionError(404, "not_found", "No InPost shipment with this id in the current mode.")
  return row
}

interface FulfillmentModuleLike {
  retrieveFulfillment(id: string, config?: Record<string, unknown>): Promise<{ id: string; data?: Record<string, unknown> | null }>
  updateFulfillment(id: string, data: Record<string, unknown>): Promise<unknown>
}

/**
 * Writes the shipment id and the tracking number into the fulfillment's
 * provider data (`inpost_shipment_id`, `inpost_tracking_number`), the
 * provider's own bookkeeping: custom code and the provider's
 * `retrieveDocuments(data, "label")` find the shipment there. The fulfillment's
 * status and labels are left to the fulfillment status writer. Live rows
 * only; never fails a flow.
 */
async function annotateFulfillment(scope: Scope, row: ParcelRow): Promise<void> {
  if (!row.fulfillment_id || row.demo || !row.shipment_id) return
  try {
    const fulfillment = resolveOptional<FulfillmentModuleLike>(scope, Modules.FULFILLMENT)
    if (!fulfillment) return
    const current = await fulfillment.retrieveFulfillment(row.fulfillment_id, { select: ["id", "data"] })
    const data = current?.data && typeof current.data === "object" ? current.data : {}
    if (data.inpost_shipment_id === row.shipment_id && (data.inpost_tracking_number ?? null) === (row.tracking_number ?? null)) return
    await fulfillment.updateFulfillment(row.fulfillment_id, { data: { ...data, inpost_shipment_id: row.shipment_id, inpost_tracking_number: row.tracking_number ?? null } })
  } catch (err) {
    const svc = inpostService(scope)
    svc.getLogger().warn(`[inpost] Could not note the shipment on fulfillment ${row.fulfillment_id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

async function requireArmed(scope: Scope, writer: "shipment" | "fulfillmentStatus"): Promise<void> {
  const svc = inpostService(scope)
  const o = svc.getOptions()
  if (!o.writers[writer]) {
    const option = writer === "shipment" ? "shipmentWriter" : "fulfillmentStatusWriter"
    throw new ActionError(409, "writer_off", `This write is turned off in the plugin options (${option} is not true); the admin cannot turn it on.`)
  }
  if (!(await isArmed(svc, writer))) throw new ActionError(409, "not_armed", "Arm the writer in Settings first (InPost, Settings, Writers).")
  if (writer === "shipment" && !o.demo && !canCallShipx(o)) throw new ActionError(409, "not_configured", `InPost is not configured: ${svc.missingOptions().join(", ")}.`)
}

/* ------------------------------------------------------------------ */
/* Recording a fulfillment                                             */
/* ------------------------------------------------------------------ */

/**
 * A fulfillment of the InPost provider was created: its row, in `pending`
 * (or `skipped` when the order was shipped outside Medusa). Idempotent: the
 * unique index on (fulfillment_id, demo) keeps one row, a second call returns
 * it. With the shipment writer armed and `autoCreate`, the shipment is
 * created in the background right away.
 */
export async function recordFulfillment(scope: Scope, orderId: string, fulfillmentId: string): Promise<ParcelRow | null> {
  const svc = inpostService(scope)
  const o = svc.getOptions()
  const demo = svc.isDemo()
  const order = await loadOrder(scope, orderId)
  const f = order?.fulfillments?.find((x) => x.id === fulfillmentId)
  if (!order || !f || !isInpostProvider(f.provider_id)) return null
  const read =
    readFulfillmentData(f.data ?? null) ??
    readFulfillmentData((order.shipping_methods ?? []).find((m) => readFulfillmentData(m.data ?? null))?.data ?? null)
  if (!read) {
    svc.getLogger().warn(`[inpost] Fulfillment ${fulfillmentId} of order ${orderId} has no InPost option in its data; nothing recorded.`)
    return null
  }
  const existing = await listParcels(svc, { order_id: orderId, demo }, { take: 50 })
  const same = existing.find((r) => r.fulfillment_id === fulfillmentId)
  if (same) return same
  const guardKey = shippedOutsideKey(order.metadata, o.skipMetadataKeys)
  const external = guardKey && !demo ? externalShipmentId((order.metadata ?? {})[guardKey]) : null
  const store = storeFor(scope)
  const inserted = await store.insertIgnore({
    order_id: order.id,
    display_id: typeof order.display_id === "number" ? order.display_id : null,
    fulfillment_id: fulfillmentId,
    demo,
    option_id: read.spec.id,
    kind: read.spec.kind,
    cod: read.spec.cod,
    service: read.spec.service,
    locker_code: read.locker?.code ?? null,
    locker_name: read.locker?.name ?? null,
    locker_address: read.locker?.address ?? null,
    parcel_size: read.size,
    parcel_no: existing.length + 1,
    currency: order.currency_code ? String(order.currency_code).toUpperCase() : null,
    state: external ? "created" : guardKey ? "skipped" : f.canceled_at ? "canceled" : "pending",
    skip_reason: guardKey,
    external: Boolean(external),
    shipment_id: external,
    created_by: external ? "external" : null,
  })
  const row = inserted ?? (await listParcels(svc, { fulfillment_id: fulfillmentId, demo }, { take: 1 }))[0] ?? null
  if (!inserted || !row) return row
  await recordEvent(scope, {
    parcel_id: row.id,
    order_id: row.order_id,
    shipment_id: row.shipment_id,
    kind: "action",
    source: "system",
    message: guardKey
      ? external
        ? `Recorded. The order was shipped outside Medusa (${guardKey}): shipment ${external} is tracked, nothing is created.`
        : `Recorded. The order was shipped outside Medusa (${guardKey}): no shipment is created.`
      : "Recorded from the fulfillment.",
    data: { action: "recorded", outcome: guardKey ? (external ? "tracked" : "skipped") : undefined, guard: guardKey ?? undefined },
    demo,
  })
  if (row.state === "pending") {
    const withPlan = await refreshProblems(scope, row)
    if (o.autoCreate && (await isArmed(svc, "shipment")) && (o.demo || canCallShipx(o)) && withPlan.problems === null) {
      inBackground(scope, `auto create ${row.id}`, () => createShipment(scope, row.id, { actor: "system", trigger: "auto" }))
    }
  } else if (external) {
    inBackground(scope, `read ${row.id}`, () => refreshParcel(scope, row.id, "poll"))
  }
  return row
}

/** A fulfillment was canceled in Medusa: a row not sent yet is canceled with it; a sent shipment keeps its state, flagged. */
export async function onFulfillmentCanceled(scope: Scope, fulfillmentId: string): Promise<ParcelRow | null> {
  const svc = inpostService(scope)
  const [row] = await listParcels(svc, { fulfillment_id: fulfillmentId, demo: svc.isDemo() }, { take: 1 })
  if (!row) return null
  const store = storeFor(scope)
  const at = now()
  const canceled = await store.transition(row.id, ["pending", "failed", "skipped"], { state: "canceled", fulfillment_canceled_at: at })
  const updated = canceled ?? (await store.transition(row.id, [row.state], { fulfillment_canceled_at: at }))
  await recordEvent(scope, {
    parcel_id: row.id,
    order_id: row.order_id,
    shipment_id: row.shipment_id,
    kind: "action",
    source: "system",
    message: canceled
      ? "The Medusa fulfillment was canceled before the shipment was created."
      : row.shipment_id
        ? "The Medusa fulfillment was canceled. The InPost shipment still exists: cancel it here while ShipX allows it, or in InPost Manager."
        : "The Medusa fulfillment was canceled.",
    data: { action: "fulfillment_canceled", outcome: canceled ? "before" : row.shipment_id ? "sent" : undefined },
    demo: Boolean(row.demo),
  })
  return updated ?? row
}

/* ------------------------------------------------------------------ */
/* Plans                                                               */
/* ------------------------------------------------------------------ */

function planRowOf(row: ParcelRow, order: OrderRecord | null): PlanRow {
  const f = order?.fulfillments?.find((x) => x.id === row.fulfillment_id)
  return {
    id: row.id,
    order_id: row.order_id,
    fulfillment_id: row.fulfillment_id,
    kind: row.kind === "courier" ? "courier" : "locker",
    cod: Boolean(row.cod),
    service: row.service === "inpost_courier_standard" ? "inpost_courier_standard" : "inpost_locker_standard",
    locker_code: row.locker_code,
    locker_name: row.locker_name,
    locker_address: row.locker_address,
    parcel_size: row.parcel_size === "small" || row.parcel_size === "medium" || row.parcel_size === "large" ? row.parcel_size : null,
    parcel_no: Number(row.parcel_no ?? 1) || 1,
    demo: Boolean(row.demo),
    fulfillment_canceled_at: row.fulfillment_canceled_at ?? f?.canceled_at ?? null,
    fulfillment_shipped_at: f?.shipped_at ?? null,
    fulfillment_delivered_at: f?.delivered_at ?? null,
    items: f?.items ?? null,
  }
}

/** A parcel that still goes out (or went out): not canceled, not skipped, not a ShipX shipment canceled since. */
function liveParcel(r: ParcelRow): boolean {
  return r.state !== "canceled" && r.state !== "skipped" && r.status !== "canceled"
}

/**
 * The parcel of the order that carries its cash on delivery: the first live
 * cash on delivery parcel (by number, then age). The buyer pays once, on
 * that one; a further parcel of the same order goes without it.
 */
export async function codCarrierOf(scope: Scope, row: ParcelRow): Promise<string | null> {
  if (!row.cod) return null
  const svc = inpostService(scope)
  const siblings = await listParcels(svc, { order_id: row.order_id, demo: Boolean(row.demo) }, { take: 50, order: { parcel_no: "ASC", created_at: "ASC" } })
  return siblings.find((r) => r.cod && liveParcel(r))?.id ?? row.id
}

export async function planOf(scope: Scope, row: ParcelRow): Promise<{ plan: Plan; order: OrderRecord | null }> {
  const svc = inpostService(scope)
  const order = await loadOrder(scope, row.order_id)
  const settings = await settingsOf(svc)
  const codCarrier = row.cod ? (await codCarrierOf(scope, row)) === row.id : undefined
  const plan = buildPlan(planRowOf(row, order), order, { options: svc.getOptions(), settings, demo: svc.isDemo(), codCarrier })
  return { plan, order }
}

export async function planForParcel(scope: Scope, id: string): Promise<{ row: ParcelRow; plan: Plan }> {
  const svc = inpostService(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  const { plan } = await planOf(scope, row)
  if (row.state === "pending" || row.state === "failed") {
    const problems = plan.problems.length > 0 ? plan.problems : null
    if (JSON.stringify(problems) !== JSON.stringify(row.problems ?? null)) await storeFor(scope).transition(row.id, [row.state], { problems })
  }
  return { row: (await getParcel(svc, row.id)) ?? row, plan }
}

/** Stores the problems of the current plan on a row not sent yet, so the Panel lists them without building plans. */
async function refreshProblems(scope: Scope, row: ParcelRow): Promise<ParcelRow> {
  try {
    const { plan } = await planOf(scope, row)
    const problems = plan.problems.length > 0 ? plan.problems : null
    return (await storeFor(scope).transition(row.id, ["pending", "failed"], { problems })) ?? row
  } catch {
    return row
  }
}

/* ------------------------------------------------------------------ */
/* Creating                                                            */
/* ------------------------------------------------------------------ */

/**
 * Creates the ShipX shipment of a pending row from its plan. A person sends
 * the hash of the plan they read (`planHash`): a plan that changed since is
 * refused. The automatic mode builds the plan and sends it as it is.
 */
export async function createShipment(scope: Scope, id: string, opts: { planHash?: string | null; actor: string | null; trigger: Trigger }): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const o = svc.getOptions()
  const demo = svc.isDemo()
  const row = mustFind(await getParcelOfMode(svc, id))
  if (row.state !== "pending") {
    throw new ActionError(409, "not_pending", row.state === "failed" ? "The last attempt failed: read the error, fix it and press Try again first." : `The shipment is ${row.state}, not waiting to be created.`)
  }
  await requireArmed(scope, "shipment")
  const { plan, order } = await planOf(scope, row)
  if (!plan.ok || !plan.request) {
    await storeFor(scope).transition(row.id, ["pending"], { problems: plan.problems })
    throw new ActionError(422, "plan_problems", `The plan has problems: ${plan.problems.map((p) => p.code).join(", ")}.`)
  }
  if (opts.trigger === "manual" && !opts.planHash) throw new ActionError(400, "plan_hash_missing", "Read the plan first: send the planHash it shows.")
  if (opts.planHash && opts.planHash !== plan.hash) throw new ActionError(409, "plan_changed", "The plan changed since it was read (the order, the settings or the shipment). Read it again.")

  const store = storeFor(scope)
  const token = randomUUID()
  const at = now()
  const claimed = await store.claim(row.id, { token, now: at, leaseUntil: new Date(at.getTime() + CREATE_LEASE_MS) })
  if (!claimed) throw new ActionError(409, "busy", "Another process is creating this shipment, or it was created a moment ago.")

  const base: ParcelPatch = {
    reference: plan.reference,
    plan_hash: plan.hash,
    cod_minor: plan.cod ? plan.cod.minor : null,
    currency: plan.cod ? "PLN" : order?.currency_code ? String(order.currency_code).toUpperCase() : row.currency,
    sending_method: plan.sendingMethod,
    parcel_size: plan.parcel.size,
    created_by: opts.actor ?? "system",
    problems: null,
  }

  let shipment: ShipxShipment
  if (demo) {
    shipment = { id: demoShipmentId(row.id), status: "created", tracking_number: null }
  } else {
    try {
      shipment = await clientFor(scope).createShipment(plan.request)
    } catch (err) {
      const d = describeError(err)
      const unclear = err instanceof InpostApiError ? err.unclear : false
      await store.finish(row.id, token, { ...base, state: unclear ? "unknown" : "failed", error: svc.mask(d.message), error_code: d.code })
      await recordEvent(scope, {
        parcel_id: row.id,
        order_id: row.order_id,
        shipment_id: null,
        kind: "action",
        source: opts.trigger === "manual" ? "admin" : "system",
        actor: opts.actor,
        message: unclear ? `No clear answer from ShipX (${d.code}). The shipment is looked up before anything is sent again.` : `ShipX refused the shipment: ${d.message}`,
        data: { action: "create", outcome: unclear ? "unknown" : "failed", code: d.code },
        demo,
      })
      svc.getLogger().warn(`[inpost] create ${row.id}: ${unclear ? "unknown" : "failed"} ${svc.mask(d.message)}`)
      return (await getParcel(svc, row.id)) ?? row
    }
  }

  const shipmentId = String(shipment.id ?? "").trim()
  const ok = await store.finish(row.id, token, {
    ...base,
    state: shipmentId ? "created" : "unknown",
    shipment_id: shipmentId || null,
    status: shipment.status || "created",
    status_at: now(),
    tracking_number: shipment.tracking_number ?? null,
    shipment_created_at: now(),
    last_checked_at: now(),
    error: shipmentId ? null : "ShipX answered without a shipment id.",
    error_code: shipmentId ? null : "no_id",
  })
  const created = (await getParcel(svc, row.id)) ?? row
  if (!ok) return created
  await recordEvent(scope, {
    parcel_id: row.id,
    order_id: row.order_id,
    shipment_id: shipmentId || null,
    kind: "action",
    source: opts.trigger === "manual" ? "admin" : demo ? "demo" : "system",
    actor: opts.actor,
    status: created.status,
    message: demo ? `Simulated shipment ${shipmentId} created (demo, nothing sent to InPost).` : `Shipment ${shipmentId} created in ShipX.`,
    data: { action: "create", outcome: "created", reference: plan.reference, cod: plan.cod?.amount ?? null },
    demo,
  })
  if (created.state === "created") {
    await emitAll(scope, createdEvents(eventSource(created)))
    await annotateFulfillment(scope, created)
  }
  svc.getLogger().info(`[inpost] ${demo ? "simulated " : ""}shipment ${shipmentId} for order ${row.display_id ?? row.order_id} (${row.kind}${row.cod ? `, COD ${plan.cod?.amount}` : ""})`)
  return created
}

/* ------------------------------------------------------------------ */
/* Statuses                                                            */
/* ------------------------------------------------------------------ */

/** The offer of a prepaid account to buy: the one of the row's service that ShipX marks available (or selected after a failed try). */
/** The offer of the shipment's own service, never another (possibly dearer) one: without it a person decides. */
export function offerToBuy(row: Pick<ParcelRow, "service">, offers: ShipxOffer[] | null | undefined): ShipxOffer | null {
  const list = offers ?? []
  return list.find((x) => x?.service?.id === row.service && (x.status === "available" || x.status === "selected")) ?? null
}

/**
 * Applies what ShipX says about a shipment: the status (compare and set, so
 * one change makes one history row and one set of events, whoever reads it
 * first), the tracking number, the offer of a prepaid account. Then the
 * follow ups of the new status.
 */
export async function applyShipment(
  scope: Scope,
  row: ParcelRow,
  shipment: Pick<ShipxShipment, "status" | "tracking_number" | "offers">,
  source: "webhook" | "poll" | "create" | "admin" | "demo",
): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const store = storeFor(scope)
  const at = now()
  const status = typeof shipment.status === "string" && shipment.status ? shipment.status : null
  if (!status) {
    await store.touch(row.id, at)
    return row
  }
  const offer = needsPayment(status) ? offerToBuy(row, shipment.offers) : null
  const updated = await store.applyStatus(row.id, row.status, {
    status,
    tracking_number: shipment.tracking_number ?? null,
    offer: offer ? { id: String(offer.id), rate: typeof offer.rate === "number" ? offer.rate : null, currency: offer.currency ?? null, status: offer.status ?? null } : null,
    at,
  })
  if (!updated) {
    const newTracking = Boolean(shipment.tracking_number && shipment.tracking_number !== row.tracking_number && status === row.status)
    if (newTracking) {
      await store.transition(row.id, [row.state], { tracking_number: shipment.tracking_number, last_checked_at: at })
    } else {
      await store.touch(row.id, at)
    }
    const fresh = (await getParcel(svc, row.id)) ?? row
    if (newTracking) await annotateFulfillment(scope, fresh)
    await followUps(scope, fresh, source)
    return fresh
  }
  let current = updated
  if (status === "canceled") current = (await store.transition(row.id, ["created"], { state: "canceled" })) ?? current
  if ((current.tracking_number ?? null) !== (row.tracking_number ?? null)) await annotateFulfillment(scope, current)
  await recordEvent(scope, {
    parcel_id: row.id,
    order_id: row.order_id,
    shipment_id: row.shipment_id,
    kind: "status",
    source,
    status,
    previous_status: row.status,
    dedupe_key: `status:${row.id}:${row.status ?? ""}:${status}:${Math.floor(at.getTime() / 60_000)}`,
    demo: Boolean(row.demo),
  })
  await emitAll(scope, statusEvents(eventSource(current), row.status))
  await followUps(scope, current, source)
  return current
}

/** What a status may lead to: buying a prepaid offer the plan promised, and the Medusa fulfillment status. */
async function followUps(scope: Scope, row: ParcelRow, source: string): Promise<void> {
  const svc = inpostService(scope)
  if (row.state === "created" && !row.external && needsPayment(row.status) && row.offer && (await isArmed(svc, "shipment"))) {
    try {
      await buyOffer(scope, row.id, { actor: "system", trigger: source === "webhook" ? "webhook" : "schedule" })
    } catch (err) {
      if (!(err instanceof ActionError && err.code === "busy")) svc.getLogger().warn(`[inpost] buy ${row.id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
    }
  }
  try {
    await syncFulfillmentStatus(scope, row)
  } catch (err) {
    svc.getLogger().warn(`[inpost] fulfillment status ${row.id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

/** Reads one shipment again (demo: the next step of the simulation) and applies it. */
export async function refreshParcel(scope: Scope, id: string, source: "poll" | "admin" | "webhook"): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  if (!row.shipment_id) throw new ActionError(409, "no_shipment", "This row has no ShipX shipment yet.")
  if (svc.isDemo()) {
    const next = demoNextStatus(row, now())
    if (!next) {
      await storeFor(scope).touch(row.id, now())
      return (await getParcel(svc, row.id)) ?? row
    }
    return applyShipment(scope, row, { status: next, tracking_number: next === "created" ? null : row.tracking_number ?? demoTrackingNumber(row.id) }, "demo")
  }
  const shipment = await clientFor(scope).getShipment(row.shipment_id)
  return applyShipment(scope, row, shipment, source === "admin" ? "admin" : source)
}

/* ------------------------------------------------------------------ */
/* Unknown rows: look before sending again                             */
/* ------------------------------------------------------------------ */

/**
 * A create without a clear answer: the shipment may exist. ShipX lists the
 * organization's shipments by receiver; one created since the claim with
 * this row's reference is adopted. Nothing found a quarter of an hour after
 * the claim: the row becomes `failed` (not_created) and a person may try
 * again. Several found: a person links the right one.
 */
export async function lookupUnknown(scope: Scope, id: string): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const store = storeFor(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  if (row.state !== "unknown") return row
  if (svc.isDemo()) {
    return (await store.transition(row.id, ["unknown"], { state: "failed", error_code: "not_created", error: "The simulated request was lost. Try again." })) ?? row
  }
  const { plan, order } = await planOf(scope, row)
  const reference = row.reference ?? plan.reference
  const email = plan.receiver.email
  const phone = normalizePhone(order?.shipping_address?.phone)
  const claimedAt = row.claimed_at ? new Date(row.claimed_at) : new Date(row.updated_at ?? Date.now())
  const since = new Date(claimedAt.getTime() - 10 * 60 * 1000).toISOString()
  const filters: Record<string, string> = email ? { receiver_email: email, created_at_gteq: since } : phone ? { receiver_phone: phone, created_at_gteq: since } : { created_at_gteq: since }
  const found = (await clientFor(scope).findShipments(filters)).filter((s) => String(s.reference ?? "") === reference)
  if (found.length === 1) {
    const s = found[0]
    const adopted = await store.transition(row.id, ["unknown"], {
      state: "created",
      shipment_id: String(s.id),
      status: s.status,
      status_at: now(),
      tracking_number: s.tracking_number ?? null,
      shipment_created_at: s.created_at ? new Date(s.created_at) : now(),
      reference,
      error: null,
      error_code: "adopted",
    })
    if (adopted) {
      await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: String(s.id), kind: "action", source: "system", message: `Shipment ${s.id} found in ShipX and adopted: nothing was sent twice.`, data: { action: "lookup", outcome: "adopted" }, demo: false })
      await emitAll(scope, createdEvents(eventSource(adopted)))
      return adopted
    }
    return (await getParcel(svc, row.id)) ?? row
  }
  if (found.length > 1) {
    await store.transition(row.id, ["unknown"], { error: `ShipX has ${found.length} shipments with this reference. Link the right one (its id from InPost Manager).`, error_code: "ambiguous", last_checked_at: now() })
    return (await getParcel(svc, row.id)) ?? row
  }
  if (Date.now() - claimedAt.getTime() < UNKNOWN_SETTLE_MS) {
    await store.touch(row.id, now())
    return (await getParcel(svc, row.id)) ?? row
  }
  const failed = await store.transition(row.id, ["unknown"], {
    state: "failed",
    error_code: "not_created",
    error: "ShipX has no shipment with this reference a quarter of an hour after the attempt. It was not created: you may try again.",
  })
  if (failed) await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: null, kind: "action", source: "system", message: "Looked up in ShipX: not created.", data: { action: "lookup", outcome: "not_created" }, demo: false })
  return failed ?? row
}

/* ------------------------------------------------------------------ */
/* Cancel, buy, pickup                                                 */
/* ------------------------------------------------------------------ */

export async function cancelShipment(scope: Scope, id: string, actor: string | null): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  if (row.state !== "created" || !row.shipment_id || row.external) throw new ActionError(409, "not_cancellable", "Only a shipment this plugin created can be canceled here.")
  await requireArmed(scope, "shipment")
  const manualPlace = row.kind === "courier" ? "WebTrucker (kurier.inpost.pl)" : "InPost Manager (manager.paczkomaty.pl)"
  let current = row
  if (!svc.isDemo()) {
    current = await applyShipment(scope, row, await clientFor(scope).getShipment(row.shipment_id), "admin")
  }
  if (!isCancellable(current.status)) {
    throw new ActionError(409, "not_cancellable", `ShipX cancels a shipment only before it is paid (created, offers prepared, offer selected); this one is ${current.status}. Cancel it in ${manualPlace}.`)
  }
  if (!svc.isDemo()) {
    try {
      await clientFor(scope).cancelShipment(current.shipment_id as string)
    } catch (err) {
      const d = describeError(err)
      if (d.code === "invalid_action") {
        await applyShipment(scope, current, await clientFor(scope).getShipment(current.shipment_id as string), "admin").catch(() => current)
        throw new ActionError(409, "not_cancellable", `ShipX no longer allows the cancel. Cancel it in ${manualPlace}.`)
      }
      throw new ActionError(502, d.code, svc.mask(d.message))
    }
  }
  await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: row.shipment_id, kind: "action", source: "admin", actor, message: svc.isDemo() ? "Simulated shipment canceled." : "Shipment canceled in ShipX.", data: { action: "cancel" }, demo: Boolean(row.demo) })
  return applyShipment(scope, current, { status: "canceled", tracking_number: null }, svc.isDemo() ? "demo" : "admin")
}

/**
 * Buys the offer of a prepaid account (status offers_prepared): the plan said
 * the shipment is paid when ShipX asks. One purchase per row per ten minutes
 * (an atomic claim), whoever asks: the webhook, the status pass or a person.
 */
export async function buyOffer(scope: Scope, id: string, opts: { actor: string | null; trigger: Trigger }): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  if (row.state !== "created" || row.external || !row.shipment_id || !needsPayment(row.status)) throw new ActionError(409, "not_payable", "Only a shipment waiting for payment (offers prepared) can be paid.")
  await requireArmed(scope, "shipment")
  const store = storeFor(scope)
  const claimed = await store.claimBuy(row.id, now())
  if (!claimed) throw new ActionError(409, "busy", "This offer was bought a moment ago; ShipX is processing it.")
  if (svc.isDemo()) {
    await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: row.shipment_id, kind: "action", source: "demo", actor: opts.actor, message: "Simulated offer bought.", data: { action: "buy" }, demo: true })
    return applyShipment(scope, claimed, { status: "confirmed", tracking_number: demoTrackingNumber(row.id) }, "demo")
  }
  const client = clientFor(scope)
  const shipment = await client.getShipment(row.shipment_id)
  if (!needsPayment(shipment.status)) return applyShipment(scope, claimed, shipment, "admin")
  const offer = offerToBuy(row, shipment.offers)
  if (!offer) {
    const reasons = (shipment.offers ?? []).flatMap((x) => (x.unavailability_reasons ?? []).map((r) => r.key ?? r.message ?? "")).filter(Boolean)
    await store.transition(row.id, ["created"], { error: `No offer to buy${reasons.length ? `: ${reasons.slice(0, 4).join(", ")}` : ""}. Check the balance and the contract in InPost Manager.`, error_code: "no_offer" })
    throw new ActionError(409, "no_offer", "ShipX has no offer to buy for this shipment. Check the balance and the contract in InPost Manager.")
  }
  try {
    const after = await client.buyOffer(row.shipment_id, offer.id)
    await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: row.shipment_id, kind: "action", source: opts.trigger === "manual" ? "admin" : "system", actor: opts.actor, message: `Offer ${offer.id} bought${typeof offer.rate === "number" ? ` (${offer.rate} ${offer.currency ?? "PLN"})` : ""}.`, data: { action: "buy", offer: String(offer.id) }, demo: false })
    return applyShipment(scope, claimed, after, "admin")
  } catch (err) {
    const d = describeError(err)
    await store.transition(row.id, ["created"], { error: svc.mask(d.message), error_code: d.code })
    throw new ActionError(502, d.code, svc.mask(d.message))
  }
}

/**
 * Orders an InPost courier to pick up confirmed shipments sent with the
 * `dispatch_order` sending method: ONE dispatch order for all of them, from
 * the sender's address in Settings. Each shipment is claimed first, so a
 * shipment is never in two pickups.
 */
export async function requestPickup(scope: Scope, ids: string[] | null, actor: string | null, trigger: Trigger = "manual"): Promise<{ dispatchOrderId: string | null; parcels: number }> {
  const svc = inpostService(scope)
  await requireArmed(scope, "shipment")
  const settings = await settingsOf(svc)
  const s = settings.sender
  const name = s.companyName || [s.firstName, s.lastName].filter(Boolean).join(" ")
  if (!settings.senderAddress || !s.phone || !name) throw new ActionError(422, "pickup_sender_missing", "A courier pickup needs the sender's name, phone and full address in Settings.")
  const candidates = (await listParcels(svc, { demo: svc.isDemo(), state: "created", status: "confirmed", sending_method: "dispatch_order", ...(ids ? { id: ids } : {}) }, { take: 100 })).filter(
    (r) => !r.external && r.shipment_id && (r.dispatch_state === null || r.dispatch_state === "failed"),
  )
  if (candidates.length === 0) return { dispatchOrderId: null, parcels: 0 }
  const store = storeFor(scope)
  const claimed = await store.claimDispatch(candidates.map((r) => r.id), now())
  const rows = candidates.filter((r) => claimed.includes(r.id))
  if (rows.length === 0) return { dispatchOrderId: null, parcels: 0 }
  let dispatchOrderId: string
  if (svc.isDemo()) {
    dispatchOrderId = `7${demoShipmentId(rows.map((r) => r.id).join(",")).slice(1, 9)}`
  } else {
    try {
      const order = await clientFor(scope).createDispatchOrder({
        shipments: rows.map((r) => Number(r.shipment_id)),
        name,
        phone: s.phone,
        ...(s.email ? { email: s.email } : {}),
        comment: `Medusa ${rows.length}`,
        address: { street: s.street, building_number: s.buildingNumber, ...(s.flatNumber ? { flat_number: s.flatNumber } : {}), city: s.city, post_code: s.postCode, country_code: "PL" },
      })
      dispatchOrderId = String(order.id)
    } catch (err) {
      const d = describeError(err)
      for (const r of rows) await store.transition(r.id, ["created"], { dispatch_state: "failed", dispatch_error: svc.mask(d.message) })
      throw new ActionError(502, d.code, svc.mask(d.message))
    }
  }
  for (const r of rows) {
    await store.transition(r.id, ["created"], { dispatch_state: "requested", dispatch_order_id: dispatchOrderId, dispatch_error: null })
    await recordEvent(scope, { parcel_id: r.id, order_id: r.order_id, shipment_id: r.shipment_id, kind: "action", source: trigger === "manual" ? "admin" : "system", actor, message: `Courier pickup ordered (dispatch order ${dispatchOrderId}).`, data: { action: "pickup", dispatch_order: dispatchOrderId }, demo: Boolean(r.demo) })
  }
  return { dispatchOrderId, parcels: rows.length }
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

/** The label PDF, fetched by the backend (the token never reaches the browser); generated in demo mode. */
export async function labelOf(scope: Scope, id: string, size: LabelSize | null): Promise<{ data: Uint8Array; contentType: string; filename: string }> {
  const svc = inpostService(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  if (row.state !== "created" || !row.shipment_id) throw new ActionError(409, "no_shipment", "There is no shipment for this row yet.")
  if (!isLabelAvailable(row.status)) throw new ActionError(409, "label_not_ready", "ShipX hands out the label once the shipment is paid (status confirmed). Try again in a moment.")
  const labelSize: LabelSize = size ?? (await settingsOf(svc)).labelFormat
  const filename = labelFileName(row.reference, row.shipment_id)
  if (svc.isDemo()) {
    const lines = [
      { text: "InPost", size: 20, bold: true },
      { text: "SIMULATED LABEL, NOT VALID FOR SHIPPING", size: 9, bold: true },
      { text: `Shipment ${row.shipment_id}`, size: 11 },
      { text: `Tracking ${row.tracking_number ?? "pending"}`, size: 9 },
      { text: row.kind === "locker" ? `Paczkomat ${row.locker_code ?? ""}` : "Courier", size: 13, bold: true },
      { text: row.kind === "locker" ? `${row.locker_address?.line1 ?? ""}, ${row.locker_address?.line2 ?? ""}` : "", size: 9 },
      { text: `Size ${row.parcel_size ?? "medium"}`, size: 10 },
      { text: row.cod && row.cod_minor ? `Cash on delivery ${formatMinor(Number(row.cod_minor))} PLN` : "", size: 10, bold: true },
      { text: row.reference ?? "", size: 10 },
    ].filter((l) => l.text)
    return { data: simpleLabelPdf(lines, labelSize), contentType: "application/pdf", filename }
  }
  const type = labelSize === "A4" && row.kind === "locker" ? "normal" : "A6"
  try {
    const file = await clientFor(scope).getLabel(row.shipment_id, type)
    return { ...file, filename }
  } catch (err) {
    const d = describeError(err)
    throw new ActionError(d.status === 404 ? 404 : 502, d.code, svc.mask(d.message))
  }
}

/* ------------------------------------------------------------------ */
/* Edits before anything is sent                                       */
/* ------------------------------------------------------------------ */

/** A locker by its code: the demo lockers in demo mode, else the public points API. Null when it does not exist. */
export async function findLocker(scope: Scope, code: string): Promise<PointDto | null> {
  const svc = inpostService(scope)
  const c = normalizeLockerCode(code)
  if (!isLockerCode(c)) return null
  if (svc.isDemo()) return searchDemoPoints(c, 1).find((p) => p.code === c) ?? null
  const q = pointsParams({ q: c, limit: 1 })
  if ("error" in q) return null
  const points = await fetchPoints(q.params, { sandbox: svc.getOptions().sandbox, timeoutMs: 8000 })
  return points.find((p) => p.code === c) ?? null
}

export async function changeLocker(scope: Scope, id: string, code: string, actor: string | null, point?: PointDto | null): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  if (row.kind !== "locker") throw new ActionError(409, "not_locker", "This is a courier shipment.")
  if (row.state !== "pending" && row.state !== "failed") throw new ActionError(409, "already_sent", "The locker of a shipment already sent cannot change here (ShipX allows it only before payment, in InPost Manager).")
  const locker = point ?? (await findLocker(scope, code))
  if (!locker) throw new ActionError(404, "locker_not_found", `InPost has no locker ${normalizeLockerCode(code)}.`)
  const updated = await storeFor(scope).transition(row.id, ["pending", "failed"], {
    locker_code: locker.code,
    locker_name: locker.name,
    locker_address: { line1: locker.address.line1, line2: locker.address.line2, city: locker.address.city, post_code: locker.address.post_code },
  })
  if (!updated) throw new ActionError(409, "changed", "The shipment changed meanwhile. Reload and try again.")
  await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: null, kind: "action", source: "admin", actor, message: `Locker changed from ${row.locker_code ?? "none"} to ${locker.code}.`, data: { action: "locker", from: row.locker_code, to: locker.code }, demo: Boolean(row.demo) })
  return refreshProblems(scope, updated)
}

export async function changeSize(scope: Scope, id: string, size: ParcelSize, actor: string | null): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  const updated = await storeFor(scope).transition(row.id, ["pending", "failed"], { parcel_size: size })
  if (!updated) throw new ActionError(409, "already_sent", "The size of a shipment already sent cannot change.")
  await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: null, kind: "action", source: "admin", actor, message: `Parcel size set to ${size}.`, data: { action: "size", size }, demo: Boolean(row.demo) })
  return refreshProblems(scope, updated)
}

/** A failed row goes back to pending, so a person may create it again (after reading the new plan). */
export async function retryParcel(scope: Scope, id: string, actor: string | null): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  const updated = await storeFor(scope).transition(row.id, ["failed"], { state: "pending", error: null, error_code: null })
  if (!updated) throw new ActionError(409, "not_failed", row.state === "unknown" ? "The shipment may exist: look it up first." : "Only a failed shipment can be tried again.")
  await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: null, kind: "action", source: "admin", actor, message: "Back to the shipments to create.", data: { action: "retry" }, demo: Boolean(row.demo) })
  return refreshProblems(scope, updated)
}

/** The shipment is handled outside the plugin (in InPost Manager, by another carrier): nothing will be created. */
export async function skipParcel(scope: Scope, id: string, actor: string | null): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  const updated = await storeFor(scope).transition(row.id, ["pending", "failed"], { state: "skipped", skip_reason: "manual" })
  if (!updated) throw new ActionError(409, "not_open", "Only a shipment not sent yet can be skipped.")
  await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: null, kind: "action", source: "admin", actor, message: "Marked as handled outside the plugin.", data: { action: "skip" }, demo: Boolean(row.demo) })
  return updated
}

/**
 * Links an existing ShipX shipment to the row (found in InPost Manager): the
 * shipment is read first, so only a real shipment of the organization is
 * linked. A row in `unknown` adopts it as its own; any other becomes an
 * external shipment (tracked, never canceled or paid from here).
 */
export async function linkShipment(scope: Scope, id: string, shipmentId: string, actor: string | null): Promise<ParcelRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getParcelOfMode(svc, id))
  const sid = String(shipmentId ?? "").trim()
  if (!/^\d{1,15}$/.test(sid)) throw new ActionError(400, "bad_id", "A ShipX shipment id has digits only.")
  if (!["pending", "failed", "unknown", "skipped"].includes(row.state)) throw new ActionError(409, "already_linked", "This row already has its shipment.")
  let shipment: ShipxShipment
  if (svc.isDemo()) {
    shipment = { id: sid, status: "confirmed", tracking_number: demoTrackingNumber(sid) }
  } else {
    try {
      shipment = await clientFor(scope).getShipment(sid)
    } catch (err) {
      const d = describeError(err)
      throw new ActionError(d.status === 404 || d.status === 403 ? 404 : 502, d.code, d.status === 404 || d.status === 403 ? `The organization has no shipment ${sid}.` : svc.mask(d.message))
    }
  }
  const own = row.state === "unknown"
  const linked = await storeFor(scope).transition(row.id, [row.state], {
    state: "created",
    shipment_id: String(shipment.id ?? sid),
    status: null,
    tracking_number: shipment.tracking_number ?? null,
    shipment_created_at: shipment.created_at ? new Date(shipment.created_at) : now(),
    external: !own,
    error: null,
    error_code: own ? "adopted" : null,
    created_by: own ? row.created_by : "external",
  })
  if (!linked) throw new ActionError(409, "changed", "The shipment changed meanwhile. Reload and try again.")
  await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: sid, kind: "action", source: "admin", actor, message: `Linked to ShipX shipment ${sid}.`, data: { action: "link", shipment: sid }, demo: Boolean(row.demo) })
  if (own) await emitAll(scope, createdEvents(eventSource({ ...linked, status: shipment.status })))
  return applyShipment(scope, linked, shipment, svc.isDemo() ? "demo" : "admin")
}

/** The tracking link of a row, for the admin and the history. */
export function trackingLinkOf(row: Pick<ParcelRow, "tracking_number" | "demo">): string | null {
  return row.tracking_number && !row.demo ? trackingUrl(row.tracking_number) : null
}

