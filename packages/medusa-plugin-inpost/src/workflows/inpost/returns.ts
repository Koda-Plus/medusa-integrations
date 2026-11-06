/**
 * THE RETURNS: recording a Medusa return that goes out on the InPost return
 * option, the plan a person reads, creating the InPost return exactly once,
 * reading it again, its label, and what a person does when InPost refused it
 * or gave no clear answer.
 *
 * InPost Returns API (InPost Group developer portal): the store creates the
 * return and InPost answers with a short drop-off code (the customer types it
 * at any Paczkomat, nothing to print) or, without the code, a label.
 *
 * EXACTLY ONCE, AND NEVER AGAIN BY ITSELF. A return is created only from a
 * row in `pending`, claimed by one statement; the request goes out once. The
 * Returns API has no search by reference and no idempotency key, so an answer
 * that never came (a timeout, a dropped connection, a 5xx) leaves the row
 * `unknown` and nothing sends it again: a person checks InPost, then presses
 * Try again or marks it handled. The database refuses a second row for one
 * order and Medusa return.
 *
 * WRITES ONLY WHEN ARMED: the returns writer allowed in the options
 * (`returnsWriter`) and armed in Settings, in the current mode. Plans, reads
 * and labels work without it.
 */

import { randomUUID } from "node:crypto"
import { CREATE_LEASE_MS, RETURNS_HOSTS } from "../../modules/inpost/lib/constants"
import type { ReturnMethod, ReturnsCheckResult } from "../../modules/inpost/lib/contract"
import { canCallReturns, missingReturnOptions, referenceFor, returnsConfigured } from "../../modules/inpost/lib/options"
import { simpleLabelPdf } from "../../modules/inpost/lib/pdf"
import type { ReturnPatch } from "../../modules/inpost/lib/return-store"
import { buildReturnPlan, demoReturnShipment, returnKey, type ReturnPlan, type ReturnRow } from "../../modules/inpost/lib/returns"
import { describeReturnsError, returnParcelOf, type ReturnShipment } from "../../modules/inpost/lib/returns-client"
import { InpostApiError } from "../../modules/inpost/lib/errors"
import {
  ActionError,
  getReturnOfMode,
  inpostService,
  isArmed,
  isInpostProvider,
  listReturns,
  loadOrder,
  queryOf,
  recordEvent,
  returnStoreFor,
  returnsClientFor,
  storeFor,
  type OrderRecord,
  type Scope,
} from "./runtime"

const now = () => new Date()

function mustFind(row: ReturnRow | null): ReturnRow {
  if (!row) throw new ActionError(404, "not_found", "No InPost return with this id in the current mode.")
  return row
}

/** A Medusa id as the admin sends it, or null. */
export function cleanReturnId(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : ""
  if (!s) return null
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(s)) throw new ActionError(400, "bad_return_id", "Not a Medusa return id.")
  return s
}

export function methodOf(v: unknown): ReturnMethod {
  return v === "label" || v === false ? "label" : "code"
}

async function requireReturnsArmed(scope: Scope): Promise<void> {
  const svc = inpostService(scope)
  const o = svc.getOptions()
  if (!o.writers.returns) throw new ActionError(409, "writer_off", "Returns are turned off in the plugin options (returnsWriter is not true); the admin cannot turn them on.")
  if (!(await isArmed(svc, "returns"))) throw new ActionError(409, "not_armed", "Arm the returns writer in Settings first (InPost, Settings, Writers).")
  if (!o.demo && !canCallReturns(o)) throw new ActionError(409, "not_configured", `InPost returns are not configured: ${missingReturnOptions(o).join(", ")}.`)
}

/* ------------------------------------------------------------------ */
/* Recording a Medusa return                                           */
/* ------------------------------------------------------------------ */

interface ReturnRecord {
  id: string
  order_id?: string | null
  fulfillments?: Array<{ id: string; provider_id?: string | null; data?: Record<string, unknown> | null } | null> | null
}

/** The Medusa return with its fulfillments; null when there is none, undefined when Query cannot read returns at all. */
async function loadMedusaReturn(scope: Scope, returnId: string): Promise<ReturnRecord | null | undefined> {
  try {
    const { data } = await queryOf(scope).graph({ entity: "return", fields: ["id", "order_id", "fulfillments.id", "fulfillments.provider_id", "fulfillments.data"], filters: { id: returnId } })
    return (data[0] as ReturnRecord | undefined) ?? null
  } catch {
    try {
      const { data } = await queryOf(scope).graph({ entity: "return", fields: ["id", "order_id"], filters: { id: returnId } })
      return (data[0] as ReturnRecord | undefined) ?? null
    } catch {
      return undefined
    }
  }
}

/** The return went out on the InPost return option: its fulfillment is of this provider and the provider marked it. */
export function isInpostReturn(r: ReturnRecord | null | undefined): boolean {
  return Boolean(r?.fulfillments?.some((f) => f && isInpostProvider(f.provider_id) && f.data && (f.data.inpost_return === true || f.data.inpost_option === "inpost-zwrot")))
}

/**
 * A Medusa return was requested (`order.return_requested`): when it goes out
 * on the InPost return option, its row is recorded, pending. Nothing is sent
 * to InPost here: a person reads the plan and creates it. Idempotent.
 */
export async function recordMedusaReturn(scope: Scope, orderId: string, returnId: string): Promise<ReturnRow | null> {
  const svc = inpostService(scope)
  const demo = svc.isDemo()
  const medusaReturn = await loadMedusaReturn(scope, returnId)
  if (!isInpostReturn(medusaReturn)) return null
  const order = await loadOrder(scope, orderId)
  if (!order) return null
  const store = returnStoreFor(scope)
  const key = returnKey(returnId)
  const inserted = await store.insertIgnore({
    order_id: order.id,
    display_id: typeof order.display_id === "number" ? order.display_id : null,
    return_id: returnId,
    return_key: key,
    demo,
    state: "pending",
  })
  const row = inserted ?? (await listReturns(svc, { order_id: order.id, return_key: key, demo }, { take: 1 }))[0] ?? null
  if (inserted) {
    await recordEvent(scope, { parcel_id: inserted.id, order_id: order.id, shipment_id: null, kind: "action", source: "system", message: `InPost return recorded from Medusa return ${returnId}.`, data: { action: "return_recorded" }, demo })
  }
  return row
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

async function assertReturnOfOrder(scope: Scope, orderId: string, returnId: string | null): Promise<void> {
  if (!returnId) return
  const r = await loadMedusaReturn(scope, returnId)
  /* Query could not read returns at all: the id is kept as the person sent it. */
  if (r === undefined) return
  if (r === null || (r.order_id && r.order_id !== orderId)) throw new ActionError(404, "return_not_found", "The order has no Medusa return with this id.")
}

export async function planReturn(scope: Scope, input: { orderId: string; returnId: string | null; method: ReturnMethod }): Promise<{ plan: ReturnPlan; order: OrderRecord; existing: ReturnRow | null }> {
  const svc = inpostService(scope)
  const o = svc.getOptions()
  const order = await loadOrder(scope, input.orderId)
  if (!order) throw new ActionError(404, "order_not_found", "No order with this id.")
  const plan = buildReturnPlan(order, { options: o, demo: svc.isDemo(), configured: returnsConfigured(o), returnId: input.returnId, method: input.method })
  const [existing] = await listReturns(svc, { order_id: order.id, return_key: returnKey(input.returnId), demo: svc.isDemo() }, { take: 1 })
  return { plan, order, existing: existing ?? null }
}

/* ------------------------------------------------------------------ */
/* Creating                                                            */
/* ------------------------------------------------------------------ */

/**
 * Creates the InPost return of an order (and Medusa return), from the plan a
 * person read: the hash must match the plan of this moment. A second create
 * for the same order and return answers 409 unless the row waits to be sent
 * (pending: recorded from Medusa, or put back by Try again).
 */
export async function createReturn(
  scope: Scope,
  input: { orderId: string; returnId: string | null; method: ReturnMethod; planHash: string | null; actor: string | null },
): Promise<ReturnRow> {
  const svc = inpostService(scope)
  const demo = svc.isDemo()
  await requireReturnsArmed(scope)
  await assertReturnOfOrder(scope, input.orderId, input.returnId)
  const { plan, order, existing } = await planReturn(scope, input)
  if (existing && existing.state !== "pending") {
    const why: Record<string, string> = {
      created: "This order already has its InPost return.",
      creating: "This return is being created right now.",
      unknown: "The last attempt got no clear answer: check InPost, then press Try again or mark it handled.",
      failed: "The last attempt was refused: read the error, fix it and press Try again first.",
      skipped: "This return is marked as handled outside the plugin.",
    }
    throw new ActionError(409, "return_exists", why[existing.state] ?? `The return is ${existing.state}.`)
  }
  if (!plan.ok || !plan.request) throw new ActionError(422, "plan_problems", `The plan has problems: ${plan.problems.map((p) => p.code).join(", ")}.`)
  if (!input.planHash) throw new ActionError(400, "plan_hash_missing", "Read the plan first: send the planHash it shows.")
  if (input.planHash !== plan.hash) throw new ActionError(409, "plan_changed", "The plan changed since it was read (the order or the settings). Read it again.")

  const store = returnStoreFor(scope)
  const key = returnKey(input.returnId)
  const row =
    existing ??
    (await store.insertIgnore({ order_id: order.id, display_id: typeof order.display_id === "number" ? order.display_id : null, return_id: input.returnId, return_key: key, demo, state: "pending", created_by: input.actor })) ??
    (await listReturns(svc, { order_id: order.id, return_key: key, demo }, { take: 1 }))[0] ??
    null
  if (!row) throw new ActionError(409, "busy", "The return changed meanwhile. Reload and try again.")
  const token = randomUUID()
  const at = now()
  const claimed = await store.claim(row.id, { token, now: at, leaseUntil: new Date(at.getTime() + CREATE_LEASE_MS) })
  if (!claimed) throw new ActionError(409, "busy", "Another process is creating this return, or it was created a moment ago.")

  const base: ReturnPatch = { method: input.method, reference: plan.reference, plan_hash: plan.hash, created_by: input.actor ?? "system" }
  let shipment: ReturnShipment
  if (demo) {
    const d = demoReturnShipment(`${row.id}:${row.attempts ?? 0}`, input.method, at)
    shipment = {
      id: d.id,
      expirationDate: d.expiresAt.toISOString(),
      parcels: [{ id: d.parcelId, trackingNumber: d.trackingNumber, parcelNumbers: [{ carrier: "INPOST", id: "STANDARD", value: d.trackingNumber }, { carrier: "INPOST", id: "SHORT", value: d.shortNumber }], ...(d.dropOffCode ? { dropOffCode: d.dropOffCode } : { labelUrl: "demo" }) }],
    }
  } else {
    try {
      shipment = await returnsClientFor(scope).createShipment(plan.request)
    } catch (err) {
      const d = describeReturnsError(err)
      const unclear = err instanceof InpostApiError ? err.unclear : false
      await store.finish(row.id, token, { ...base, state: unclear ? "unknown" : "failed", error: svc.mask(d.message), error_code: d.code })
      await recordEvent(scope, {
        parcel_id: row.id,
        order_id: row.order_id,
        shipment_id: null,
        kind: "action",
        source: "admin",
        actor: input.actor,
        message: unclear ? `No clear answer from the InPost Returns API (${d.code}). Check InPost before trying again.` : `InPost refused the return: ${d.message}`,
        data: { action: "return_create", outcome: unclear ? "unknown" : "failed", code: d.code },
        demo,
      })
      svc.getLogger().warn(`[inpost] return ${row.id}: ${unclear ? "unknown" : "failed"} ${svc.mask(d.message)}`)
      return (await getReturnOfMode(svc, row.id)) ?? row
    }
  }

  const shipmentId = String(shipment?.id ?? "").trim()
  const parcel = returnParcelOf(shipment)
  const expires = shipment?.expirationDate ? new Date(shipment.expirationDate) : null
  await store.finish(row.id, token, {
    ...base,
    state: shipmentId ? "created" : "unknown",
    shipment_id: shipmentId || null,
    inpost_parcel_id: parcel.parcelId,
    tracking_number: parcel.trackingNumber,
    short_number: parcel.shortNumber,
    drop_off_code: parcel.dropOffCode,
    has_label: parcel.hasLabel,
    expires_at: expires && Number.isFinite(expires.getTime()) ? expires : null,
    shipment_created_at: now(),
    last_checked_at: now(),
    error: shipmentId ? null : "InPost answered without a return id. Check InPost before trying again.",
    error_code: shipmentId ? null : "no_id",
  })
  const created = (await getReturnOfMode(svc, row.id)) ?? row
  await recordEvent(scope, {
    parcel_id: row.id,
    order_id: row.order_id,
    shipment_id: shipmentId || null,
    kind: "action",
    source: demo ? "demo" : "admin",
    actor: input.actor,
    message: demo ? `Simulated return ${shipmentId} created (demo, nothing sent to InPost).` : `Return ${shipmentId} created in InPost.`,
    data: { action: "return_create", outcome: shipmentId ? "created" : "unknown", method: input.method },
    demo,
  })
  svc.getLogger().info(`[inpost] ${demo ? "simulated " : ""}return ${shipmentId} for order ${row.display_id ?? row.order_id} (${input.method === "code" ? "drop-off code" : "label"})`)
  return created
}

/* ------------------------------------------------------------------ */
/* Reading, the label, what a person does                              */
/* ------------------------------------------------------------------ */

/** Reads the return from InPost again (the code, the numbers, the expiry). The API has no status: tracking is another API. */
export async function refreshReturn(scope: Scope, id: string): Promise<ReturnRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getReturnOfMode(svc, id))
  if (row.state !== "created" || !row.shipment_id) throw new ActionError(409, "no_return", "This row has no InPost return yet.")
  const store = returnStoreFor(scope)
  if (svc.isDemo()) return (await store.transition(row.id, ["created"], { last_checked_at: now() })) ?? row
  let shipment: ReturnShipment
  try {
    shipment = await returnsClientFor(scope).getShipment(row.shipment_id)
  } catch (err) {
    const d = describeReturnsError(err)
    throw new ActionError(d.status === 404 ? 404 : 502, d.code, svc.mask(d.message))
  }
  const parcel = returnParcelOf(shipment)
  const expires = shipment?.expirationDate ? new Date(shipment.expirationDate) : null
  return (
    (await store.transition(row.id, ["created"], {
      tracking_number: parcel.trackingNumber ?? row.tracking_number,
      short_number: parcel.shortNumber ?? row.short_number,
      drop_off_code: parcel.dropOffCode ?? row.drop_off_code,
      has_label: parcel.hasLabel || Boolean(row.has_label),
      inpost_parcel_id: parcel.parcelId ?? row.inpost_parcel_id,
      expires_at: expires && Number.isFinite(expires.getTime()) ? expires : undefined,
      last_checked_at: now(),
    })) ?? row
  )
}

/** The label PDF (A4) of a return without a drop-off code, fetched by the backend; generated in demo mode. */
export async function returnLabelOf(scope: Scope, id: string): Promise<{ data: Uint8Array; contentType: string; filename: string }> {
  const svc = inpostService(scope)
  const row = mustFind(await getReturnOfMode(svc, id))
  if (row.state !== "created" || !row.tracking_number) throw new ActionError(409, "no_return", "There is no InPost return for this row yet.")
  if (!row.has_label) throw new ActionError(409, "no_label", "This return goes with a drop-off code: the customer types it at the Paczkomat, there is no label.")
  const filename = `inpost-return-${String(row.display_id ?? row.tracking_number).replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`
  if (svc.isDemo()) {
    const lines = [
      { text: "InPost", size: 22, bold: true },
      { text: "SIMULATED RETURN LABEL, NOT VALID FOR SHIPPING", size: 11, bold: true },
      { text: `Return ${row.shipment_id ?? ""}`, size: 11 },
      { text: `Tracking ${row.tracking_number}`, size: 12, bold: true },
      { text: row.short_number ? `Short number ${row.short_number}` : "", size: 11 },
      { text: row.reference ?? "", size: 11 },
    ].filter((l) => l.text)
    return { data: simpleLabelPdf(lines, "A4"), contentType: "application/pdf", filename }
  }
  try {
    const file = await returnsClientFor(scope).getLabel(row.tracking_number)
    return { ...file, filename }
  } catch (err) {
    const d = describeReturnsError(err)
    throw new ActionError(d.status === 404 ? 404 : 502, d.code, svc.mask(d.message))
  }
}

/**
 * Back to pending, so a person may create it again from a new plan. A row in
 * `unknown` needs `checked`: the person says they looked in InPost and the
 * return is not there (it may exist; nothing can look it up).
 */
export async function retryReturn(scope: Scope, id: string, actor: string | null, checked: boolean): Promise<ReturnRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getReturnOfMode(svc, id))
  if (row.state === "unknown" && !checked) throw new ActionError(409, "check_first", "The return may exist in InPost. Check there first, then confirm that it is not there.")
  const updated = await returnStoreFor(scope).transition(row.id, ["failed", "unknown"], { state: "pending", error: null, error_code: null })
  if (!updated) throw new ActionError(409, "not_failed", "Only a refused return, or one without a clear answer, can be tried again.")
  await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: null, kind: "action", source: "admin", actor, message: "Return back to the ones to create.", data: { action: "return_retry", outcome: row.state === "unknown" ? "checked" : undefined }, demo: Boolean(row.demo) })
  return updated
}

/** Handled outside the plugin (created in InPost by hand, or not needed): nothing will be sent for it. */
export async function skipReturn(scope: Scope, id: string, actor: string | null): Promise<ReturnRow> {
  const svc = inpostService(scope)
  const row = mustFind(await getReturnOfMode(svc, id))
  const updated = await returnStoreFor(scope).transition(row.id, ["pending", "failed", "unknown"], { state: "skipped", skip_reason: "manual" })
  if (!updated) throw new ActionError(409, "not_open", "Only a return not created yet can be marked handled.")
  await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: null, kind: "action", source: "admin", actor, message: "Return marked as handled outside the plugin.", data: { action: "return_skip" }, demo: Boolean(row.demo) })
  return updated
}

/** Creates whose process died: unknown (the return may exist), never pending. For the status pass. */
export async function expireReturnLeases(scope: Scope): Promise<number> {
  const svc = inpostService(scope)
  return returnStoreFor(scope).expireLeases(now(), svc.isDemo())
}

/* ------------------------------------------------------------------ */
/* The connection                                                      */
/* ------------------------------------------------------------------ */

const CHECK_KEY = Symbol.for("koda.inpost.lastReturnsCheck")
type CheckHolder = typeof globalThis & { [CHECK_KEY]?: ReturnsCheckResult }

export function lastReturnsCheck(mode: "demo" | "live"): ReturnsCheckResult | null {
  const r = (globalThis as CheckHolder)[CHECK_KEY] ?? null
  return r && r.mode === mode ? r : null
}

/** "Test connection": gets a token, nothing else (no return is read or created). */
export async function checkReturnsConnection(scope: Scope): Promise<ReturnsCheckResult> {
  const svc = inpostService(scope)
  const o = svc.getOptions()
  const checkedAt = now().toISOString()
  let result: ReturnsCheckResult
  if (o.demo) {
    result = { ok: true, mode: "demo", environment: o.returns.environment, checkedAt, error: null, expiresIn: 599, scope: "api:returns:read api:returns:write" }
  } else if (!returnsConfigured(o)) {
    result = { ok: false, mode: "live", environment: o.returns.environment, checkedAt, error: `Missing options: ${missingReturnOptions(o).join(", ")}.`, expiresIn: null, scope: null }
  } else {
    try {
      const t = await returnsClientFor(scope).checkToken()
      result = { ok: true, mode: "live", environment: o.returns.environment, checkedAt, error: null, expiresIn: t.expiresIn, scope: t.scope }
    } catch (err) {
      result = { ok: false, mode: "live", environment: o.returns.environment, checkedAt, error: svc.mask(describeReturnsError(err).message), expiresIn: null, scope: null }
    }
  }
  ;(globalThis as CheckHolder)[CHECK_KEY] = result
  return result
}

export function returnsHost(environment: "stage" | "production"): string {
  return RETURNS_HOSTS[environment]
}

/* ------------------------------------------------------------------ */
/* Demo                                                                */
/* ------------------------------------------------------------------ */

export const DEMO_RETURNS_KEY = "demo:returns-seeded"

/**
 * Demo mode: three sample returns from the store's orders (one with a
 * drop-off code, one with a label, one waiting to be created), once (an
 * atomic claim of `demo:returns-seeded`).
 */
export async function ensureDemoReturns(scope: Scope, orders: Array<{ id: string; display_id?: number | null }>): Promise<number> {
  const svc = inpostService(scope)
  if (!svc.isDemo() || orders.length === 0) return 0
  const existing = await listReturns(svc, { demo: true }, { take: 1, select: ["id"] })
  if (existing.length > 0) return 0
  const store = returnStoreFor(scope)
  if (!(await storeFor(scope).claimSetting(DEMO_RETURNS_KEY, { at: now().toISOString() }))) return 0
  /* The oldest of the newest orders: their sample shipments are the delivered ones. */
  const picks = [...orders].slice(-3).reverse()
  const o = svc.getOptions()
  let n = 0
  for (const [i, order] of picks.entries()) {
    const method: ReturnMethod = i === 1 ? "label" : "code"
    const created = i < 2
    const at = new Date(Date.now() - (i + 1) * 26 * 3600 * 1000)
    const d = demoReturnShipment(`seed:${order.id}`, method, at)
    const displayId = typeof order.display_id === "number" ? order.display_id : null
    const row = await store.insertIgnore({
      order_id: order.id,
      display_id: displayId,
      return_id: null,
      return_key: "-",
      demo: true,
      state: created ? "created" : "pending",
      method: created ? method : null,
      reference: created ? referenceFor(o.referenceTemplate, { displayId, orderId: order.id, fulfillmentId: null }) : null,
      shipment_id: created ? d.id : null,
      inpost_parcel_id: created ? d.parcelId : null,
      tracking_number: created ? d.trackingNumber : null,
      short_number: created ? d.shortNumber : null,
      drop_off_code: created ? d.dropOffCode : null,
      has_label: created && d.hasLabel,
      expires_at: created ? d.expiresAt : null,
      shipment_created_at: created ? at : null,
      created_by: "demo-seed",
    })
    if (!row) continue
    n += 1
    await recordEvent(scope, { parcel_id: row.id, order_id: row.order_id, shipment_id: row.shipment_id, kind: "action", source: "demo", message: created ? "Sample return." : "Sample return waiting to be created.", data: { action: "return_sample", outcome: created ? "created" : "pending" }, demo: true, occurred_at: at })
  }
  return n
}
