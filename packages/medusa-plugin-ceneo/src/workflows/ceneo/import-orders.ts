/**
 * KUP TERAZ, WRITE SIDE: the writers, the import of stored orders into
 * Medusa, cancellations from Ceneo, and the writes Ceneo gets back.
 *
 *   orders writer  `runCeneoImport`: every stored order of the current mode
 *                  whose state is in `orders.importStates` and whose items
 *                  all have a variant is claimed (one SQL statement), its
 *                  personal data read from Ceneo NOW (never stored by the
 *                  plugin), and created in Medusa. A Ceneo cancellation of
 *                  an imported order cancels it in Medusa when nothing was
 *                  fulfilled; otherwise a person is asked.
 *   status writer  `runCeneoWrites`: the shop order number and the
 *                  confirmation after an import, the parcel number and
 *                  "sent" after a shipment, the cancellation after the
 *                  store cancelled. One write per order per run, in order.
 *
 * Both run after the order sync of the same job, each under its own lock.
 * A Ceneo state that is unknown (not in the dictionary, not in the options)
 * never changes a Medusa order.
 */

import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CeneoApiError, CeneoClient, odataString } from "../../modules/ceneo/lib/ceneo-client"
import type { ImportRunResult, WriteRunResult, WriterDto } from "../../modules/ceneo/lib/contract"
import { claimImport, finishImport, mergeWrites, recordDraft, releaseStale, withRunLease, type SqlRunner } from "../../modules/ceneo/lib/import-claim"
import { demoWriteTransport, liveWriteTransport, type CeneoWriteTransport } from "../../modules/ceneo/lib/kup-teraz-write"
import {
  IMPORT_LEASE_MS,
  IMPORT_MAX_ATTEMPTS,
  afterWrite,
  afterWriteFailure,
  cancelDecision,
  importDecision,
  nextAttemptAt,
  nextWrite,
  toMedusaOrder,
  trackingOf,
  writesPatch,
  type CeneoWrites,
  type ImportRow,
} from "../../modules/ceneo/lib/order-input"
import { ceneoSvc, type CeneoServiceLike, type Row } from "../../modules/ceneo/lib/store"
import { WRITER_KEYS, afterOutcome, outcomeOfStatus, writerState, type WriteOutcome, type WriterKey, type WriterRow, type WriterState } from "../../modules/ceneo/lib/writers"
import { CatalogError, resolveRegion, resolveSalesChannel } from "./catalog"
import { cancelCeneoOrder, completeCeneoOrder, createCeneoDraft, orderStatuses } from "./medusa-order"
import { ORDER_FIELDS, transportOf } from "./orders"
import { errorText, queryOf, withLock, type Scope } from "./runtime"

export const IMPORT_FIELDS = [...ORDER_FIELDS, "import_status", "import_attempts", "import_next_at", "import_error", "imported_at", "ceneo_writes", "writes_due", "cancel_handled_at", "updated_at"]
/** A run holds its writer's database lease this long at most (a dead process frees it then). */
const RUN_LEASE_MS = 15 * 60_000
/** Orders handled per run: the rest waits 5 minutes. */
const IMPORTS_PER_RUN = 20
const WRITES_PER_RUN = 50
/** Imported orders whose writes are still watched. */
const WRITES_WINDOW_DAYS = 30

export function sqlOf(scope: Scope): SqlRunner {
  return scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlRunner
}

const modeOf = (svc: CeneoServiceLike): "demo" | "live" => (svc.getOptions().demo ? "demo" : "live")
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" && v ? new Date(v).toISOString() : null)

/* ---- writer rows ------------------------------------------------------- */

export async function writerRows(svc: CeneoServiceLike): Promise<Map<WriterKey, WriterRow>> {
  const rows = (await svc.listCeneoWriters({ id: [...WRITER_KEYS] }, { take: null })) as unknown as WriterRow[]
  return new Map(rows.map((r) => [r.id as WriterKey, r]))
}

export function stateOf(svc: CeneoServiceLike, key: WriterKey, row: WriterRow | null): WriterState {
  const o = svc.getOptions()
  return writerState({ key, allowed: o.writes[key], row, mode: modeOf(svc), hasKey: Boolean(o.apiKey), importStates: o.orders.importStates, maxBid: o.cpc.maxBid })
}

export async function writerDtos(svc: CeneoServiceLike): Promise<WriterDto[]> {
  const rows = await writerRows(svc)
  return WRITER_KEYS.map((key) => {
    const row = rows.get(key) ?? null
    const s = stateOf(svc, key, row)
    return {
      ...s,
      changedBy: row?.changed_by ?? null,
      changedAt: iso(row?.changed_at),
      failureStreak: Number(row?.failure_streak) || 0,
      lastFailure: row?.last_failure ?? null,
      lastFailureAt: iso(row?.last_failure_at),
      trippedAt: iso(row?.tripped_at),
      tripReason: row?.trip_reason ?? null,
      lastSuccessAt: iso(row?.last_success_at),
    }
  })
}

/** Arms or disarms a writer for the current mode (the row is created on first use). */
export async function setWriter(svc: CeneoServiceLike, key: WriterKey, patch: Record<string, unknown>): Promise<void> {
  const [row] = await svc.listCeneoWriters({ id: key }, { take: 1, select: ["id"] })
  if (row) await svc.updateCeneoWriters([{ id: key, ...patch }])
  else {
    try {
      await svc.createCeneoWriters([{ id: key, ...patch }])
    } catch {
      /* Created by another request meanwhile. */
      await svc.updateCeneoWriters([{ id: key, ...patch }])
    }
  }
}

/** One write's outcome on the writer row: the streak, and the circuit breaker. True when it tripped. */
export async function recordOutcome(svc: CeneoServiceLike, key: WriterKey, outcome: WriteOutcome): Promise<boolean> {
  const rows = await writerRows(svc)
  const row = rows.get(key)
  if (!row) return false
  const { patch, tripped } = afterOutcome(row, outcome, new Date())
  await svc.updateCeneoWriters([{ id: key, ...patch }])
  if (tripped) svc.getLogger().warn(`[ceneo] The ${key} writer was disarmed by the circuit breaker: ${outcome.kind === "ok" ? "" : outcome.message}`)
  return tripped
}

function outcomeOfError(err: unknown): WriteOutcome {
  const message = errorText(err)
  if (err instanceof CeneoApiError) return outcomeOfStatus(err.status, message)
  return { kind: "systemic", message }
}

/* MedusaError types that belong to one order (its data, its stock, its state); any other error counts against the writer. */
const ORDER_ERROR_TYPES = new Set(["not_found", "invalid_data", "invalid_argument", "not_allowed", "duplicate_error", "conflict", "payment_authorization_error"])

/**
 * An import failure: Ceneo by its status; a configuration gap (no PLN
 * region, no sales channel) and anything that is not a Medusa refusal of
 * this one order (the database, a timeout, an unexpected state) for the
 * writer, so the breaker sees it; Medusa refusing the order itself (stock,
 * a variant gone, a shipping option) for that one order.
 */
function importOutcome(err: unknown): WriteOutcome {
  const message = errorText(err)
  if (err instanceof CeneoApiError) return outcomeOfStatus(err.status, message)
  if (err instanceof CatalogError) return { kind: "systemic", message }
  const type = err && typeof err === "object" ? (err as { type?: unknown }).type : undefined
  if (typeof type === "string" && ORDER_ERROR_TYPES.has(type)) return { kind: "item", message }
  return { kind: "systemic", message }
}

/* ---- import ------------------------------------------------------------- */

function asImportRow(r: Row): ImportRow {
  return {
    id: r.id,
    ceneo_order_id: String(r.ceneo_order_id),
    displayed_order_id: typeof r.displayed_order_id === "string" ? r.displayed_order_id : null,
    state_id: typeof r.state_id === "number" ? r.state_id : null,
    amounts: (r.amounts as ImportRow["amounts"]) ?? null,
    delivery_form: typeof r.delivery_form === "string" ? r.delivery_form : null,
    payment_type_id: typeof r.payment_type_id === "number" ? r.payment_type_id : null,
    items: Array.isArray(r.items) ? (r.items as ImportRow["items"]) : null,
    matched: r.matched === true,
    demo: r.demo === true,
    medusa_order_id: typeof r.medusa_order_id === "string" ? r.medusa_order_id : null,
    import_status: (typeof r.import_status === "string" ? r.import_status : null) as ImportRow["import_status"],
    import_attempts: Number(r.import_attempts) || 0,
    import_next_at: (r.import_next_at as Date | string | null) ?? null,
    ceneo_writes: (r.ceneo_writes as CeneoWrites | null) ?? null,
  }
}

export async function runCeneoImport(scope: Scope, input: { trigger?: string; now?: number } = {}): Promise<ImportRunResult> {
  const svc = ceneoSvc(scope)
  const o = svc.getOptions()
  const state = stateOf(svc, "orders", (await writerRows(svc)).get("orders") ?? null)
  if (!state.effective) return { status: "off", blockers: state.blockers, requested: state.requested }
  const transport = await transportOf(svc)
  if (!transport) return { status: "off", blockers: ["missing_key"], requested: state.requested }
  const sql = sqlOf(scope)
  const result = await withLock("import", async () => withRunLease(sql, "orders", RUN_LEASE_MS, async (): Promise<ImportRunResult> => {
    const started = Date.now()
    const now = input.now ?? started
    const container = scope as MedusaContainer
    let imported = 0
    let failed = 0
    let held = 0
    let canceled = 0
    const released = await releaseStale(sql, new Date(now))
    const fresh = await svc.listCeneoOrders({ demo: o.demo, import_status: null, medusa_order_id: null, matched: true, state_id: o.orders.importStates }, { take: IMPORTS_PER_RUN, select: IMPORT_FIELDS, order: { ordered_at: "ASC" } })
    /* Retries: a draft to finish whatever the state is now, otherwise only orders still importable (a cancelled one never blocks the queue). */
    const retryBase = { demo: o.demo, import_status: "failed", import_attempts: { $lt: IMPORT_MAX_ATTEMPTS } }
    const retryConfig = { take: IMPORTS_PER_RUN, select: IMPORT_FIELDS, order: { import_next_at: "ASC" } }
    const [finish, retries] = await Promise.all([
      svc.listCeneoOrders({ ...retryBase, medusa_order_id: { $ne: null } }, retryConfig),
      svc.listCeneoOrders({ ...retryBase, medusa_order_id: null, matched: true, state_id: o.orders.importStates }, retryConfig),
    ])
    const candidates = [...finish, ...retries, ...fresh].map(asImportRow)
    const ready = candidates.filter((r) => importDecision(r, { demo: o.demo, importStates: o.orders.importStates, now }).kind === "import").slice(0, IMPORTS_PER_RUN)
    let place: { regionId: string; salesChannelId: string } | null = null
    for (const row of ready) {
      const token = randomUUID()
      const claimed = await claimImport(sql, row.id, { token, leaseUntil: new Date(Date.now() + IMPORT_LEASE_MS), now: new Date(now), maxAttempts: IMPORT_MAX_ATTEMPTS })
      if (!claimed) continue
      const attempts = row.import_attempts + 1
      /* A draft this attempt created whose id is not on the row yet: a retry would create a second one. */
      let unrecorded: string | null = null
      try {
        let medusaId = row.medusa_order_id
        let email: string | null = null
        if (!medusaId) {
          const query = queryOf(scope)
          place ??= { regionId: await resolveRegion(query, o), salesChannelId: await resolveSalesChannel(query, o) }
          const detail = await transport.detail(row.ceneo_order_id)
          const built = toMedusaOrder(row, detail, { ...place, shippingOptionId: o.orders.shippingOptionId })
          if (!built.ok) {
            await finishImport(sql, row.id, token, { status: "held", error: `Not imported: ${built.problem}.` })
            held += 1
            continue
          }
          email = built.email
          medusaId = await createCeneoDraft(container, built.order)
          unrecorded = medusaId
          if (!(await recordDraft(sql, row.id, medusaId))) {
            /* The row already names another Medusa order: two drafts exist, a person keeps one. */
            await finishImport(sql, row.id, token, { status: "held", error: `A second Medusa draft (${medusaId}) was created for this Ceneo order: keep one, delete the other, then retry.` })
            svc.getLogger().warn(`[ceneo] Kup Teraz ${row.ceneo_order_id}: draft ${medusaId} created, but the row already names another Medusa order. Held.`)
            held += 1
            continue
          }
          unrecorded = null
        } else {
          /* Finishing a draft of an earlier attempt: the e-mail is read again only if Ceneo still answers. */
          const again = await transport.detail(row.ceneo_order_id).catch(() => null)
          const mail = again?.shipping[0]?.Email
          email = typeof mail === "string" && mail.trim() ? mail.trim() : null
        }
        const paid = !o.demo && row.payment_type_id !== null && o.orders.paidPaymentTypes.includes(row.payment_type_id)
        await completeCeneoOrder(container, medusaId, { email, paid, demo: o.demo })
        if (await finishImport(sql, row.id, token, { status: "imported", importedAt: new Date() })) {
          imported += 1
          await recordOutcome(svc, "orders", { kind: "ok" })
        } else {
          /* The claim ran out meanwhile: the row is failed or held now, and the next attempt finishes the order it names. */
          svc.getLogger().warn(`[ceneo] Kup Teraz ${row.ceneo_order_id}: Medusa order ${medusaId} completed after the claim ran out; the next run checks it.`)
        }
      } catch (err) {
        const outcome = importOutcome(err)
        const message = outcome.kind === "ok" ? "" : outcome.message
        if (unrecorded) {
          await finishImport(sql, row.id, token, { status: "held", error: `Medusa draft ${unrecorded} exists, but its id could not be saved on this row (${message}). Check it, then retry or delete it.` }).catch(() => undefined)
          svc.getLogger().error(`[ceneo] Kup Teraz ${row.ceneo_order_id}: draft ${unrecorded} created but not recorded: ${message}`)
          held += 1
        } else {
          await finishImport(sql, row.id, token, { status: "failed", error: message, nextAt: nextAttemptAt(attempts, Date.now()) })
          failed += 1
        }
        if (await recordOutcome(svc, "orders", outcome)) break
      }
    }
    /* Ceneo cancellations change Medusa orders, so they run under the orders writer. */
    canceled = await cancelFromCeneo(scope, svc, sql)
    const out: ImportRunResult = { status: "ran", imported, failed, held, canceled, released, demo: o.demo, duration_ms: Date.now() - started }
    if (imported + failed + held + canceled + released > 0) svc.getLogger().info(`[ceneo] Kup Teraz import (${input.trigger ?? "schedule"}): ${imported} imported, ${failed} failed, ${held} held, ${canceled} cancelled from Ceneo${released > 0 ? `, ${released} interrupted claims released` : ""}.`)
    return out
  }))
  return result ?? { status: "skipped", reason: "running" }
}

/** Imported orders that Ceneo now reports in a cancelled state, not dealt with yet. */
async function cancelFromCeneo(scope: Scope, svc: CeneoServiceLike, sql: SqlRunner): Promise<number> {
  const o = svc.getOptions()
  if (o.orders.canceledStates.length === 0) return 0
  const rows = (await svc.listCeneoOrders({ demo: o.demo, import_status: "imported", state_id: o.orders.canceledStates, cancel_handled_at: null }, { take: 100, select: IMPORT_FIELDS, order: { updated_at: "ASC" } })).map(asImportRow)
  const todo = rows.filter((r) => r.medusa_order_id)
  if (todo.length === 0) return 0
  const statuses = await orderStatuses(queryOf(scope), todo.map((r) => String(r.medusa_order_id)))
  let done = 0
  for (const r of todo) {
    const decision = cancelDecision(r.state_id, o.orders.canceledStates, statuses.get(String(r.medusa_order_id)) ?? null)
    const now = new Date()
    if (decision.kind === "none") continue
    if (decision.kind === "attention") {
      await mergeWrites(sql, r.id, { attention: decision.reason }, { cancelHandled: now })
      continue
    }
    try {
      if (decision.kind === "cancel") await cancelCeneoOrder(scope as MedusaContainer, String(r.medusa_order_id), o.demo)
      await mergeWrites(sql, r.id, { canceled_by_ceneo_at: now.toISOString() }, { cancelHandled: now, due: false })
      done += decision.kind === "cancel" ? 1 : 0
    } catch (err) {
      await mergeWrites(sql, r.id, { attention: `Cancelled at Ceneo, but Medusa refused to cancel the order: ${errorText(err)}` }, { cancelHandled: now })
    }
  }
  return done
}

/* ---- writes to Ceneo ---------------------------------------------------- */

export function writeTransportOf(svc: CeneoServiceLike, writers: readonly WriterKey[]): CeneoWriteTransport | null {
  const o = svc.getOptions()
  if (o.demo) return demoWriteTransport()
  if (!o.apiKey) return null
  return liveWriteTransport(new CeneoClient({ apiKey: o.apiKey, timeoutMs: o.timeoutMs, logger: svc.getLogger(), writers }), odataString)
}

export async function runCeneoWrites(scope: Scope, input: { trigger?: string } = {}): Promise<WriteRunResult> {
  const svc = ceneoSvc(scope)
  const o = svc.getOptions()
  const state = stateOf(svc, "status", (await writerRows(svc)).get("status") ?? null)
  if (!state.effective) return { status: "off", blockers: state.blockers, requested: state.requested }
  const transport = writeTransportOf(svc, ["status"])
  if (!transport) return { status: "off", blockers: ["missing_key"], requested: state.requested }
  const sql = sqlOf(scope)
  const result = await withLock("writes", async () => withRunLease(sql, "status", RUN_LEASE_MS, async (): Promise<WriteRunResult> => {
    const started = Date.now()
    /* Only orders with a write waiting (`writes_due`), the longest waiting first: a busy store never starves the newest. */
    const raw = await svc.listCeneoOrders({ demo: o.demo, import_status: "imported", writes_due: true }, { take: WRITES_PER_RUN * 2, select: IMPORT_FIELDS, order: { updated_at: "ASC" } })
    const readAt = new Map(raw.map((r) => [r.id, r.updated_at instanceof Date ? r.updated_at : typeof r.updated_at === "string" ? new Date(r.updated_at) : null]))
    const rows = raw.map(asImportRow)
    const statuses = await orderStatuses(queryOf(scope), rows.map((r) => String(r.medusa_order_id)).filter(Boolean))
    let sent = 0
    let failed = 0
    for (const r of rows) {
      if (sent + failed >= WRITES_PER_RUN) break
      const displayId = statuses.get(String(r.medusa_order_id))?.displayId ?? null
      const w = nextWrite(r, displayId)
      if (!w) {
        /* Nothing waits (all sent, or out of attempts): off the queue until an event puts it back. */
        await mergeWrites(sql, r.id, {}, { due: false, readAt: readAt.get(r.id) ?? null })
        continue
      }
      const at = new Date().toISOString()
      try {
        await transport.run(r.ceneo_order_id, w)
        const after = afterWrite(r.ceneo_writes, w, at)
        await mergeWrites(sql, r.id, writesPatch(r.ceneo_writes, after), { due: nextWrite({ ...r, ceneo_writes: after }, displayId) !== null, readAt: readAt.get(r.id) ?? null })
        sent += 1
        await recordOutcome(svc, "status", { kind: "ok" })
      } catch (err) {
        const outcome = outcomeOfError(err)
        const message = outcome.kind === "ok" ? "" : outcome.message
        const after = afterWriteFailure(r.ceneo_writes, `${w.kind}: ${message}`, at, outcome.kind === "item")
        await mergeWrites(sql, r.id, writesPatch(r.ceneo_writes, after))
        failed += 1
        if (await recordOutcome(svc, "status", outcome)) break
      }
    }
    const out: WriteRunResult = { status: "ran", sent, failed, demo: transport.demo, duration_ms: Date.now() - started }
    if (sent + failed > 0) svc.getLogger().info(`[ceneo] Kup Teraz writes (${input.trigger ?? "schedule"}): ${sent} sent to Ceneo, ${failed} failed.`)
    return out
  }))
  return result ?? { status: "skipped", reason: "running" }
}

/* ---- events from Medusa ------------------------------------------------- */

/** A shipment of an imported order: its parcel number (or only "sent") waits for the status writer. */
export async function queueShipment(scope: Scope, medusaOrderId: string): Promise<boolean> {
  const svc = ceneoSvc(scope)
  const o = svc.getOptions()
  const [row] = await svc.listCeneoOrders({ medusa_order_id: medusaOrderId, import_status: "imported" }, { take: 1, select: IMPORT_FIELDS })
  if (!row) return false
  const r = asImportRow(row)
  const w: CeneoWrites = {}
  if (r.ceneo_writes?.shipment || r.ceneo_writes?.sent_at || r.ceneo_writes?.send_requested_at || r.ceneo_writes?.cancel) return false
  const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id", "fulfillments.created_at", "fulfillments.labels.tracking_number"], filters: { id: medusaOrderId } })
  const fulfillments = ((data as Array<{ fulfillments?: Parameters<typeof trackingOf>[0] | null }>)[0]?.fulfillments ?? []) as Parameters<typeof trackingOf>[0]
  const tracking = trackingOf(fulfillments)
  const at = new Date().toISOString()
  if (tracking && o.orders.carrierId) w.shipment = { tracking, carrier_id: o.orders.carrierId, queued_at: at }
  else w.send_requested_at = at
  await mergeWrites(sqlOf(scope), r.id, w as Record<string, unknown>, { due: true })
  return true
}

/** The store cancelled an imported order: Ceneo is told, unless Ceneo cancelled it first. */
export async function queueCancel(scope: Scope, medusaOrderId: string): Promise<boolean> {
  const svc = ceneoSvc(scope)
  const o = svc.getOptions()
  const [row] = await svc.listCeneoOrders({ medusa_order_id: medusaOrderId, import_status: "imported" }, { take: 1, select: IMPORT_FIELDS })
  if (!row) return false
  const r = asImportRow(row)
  if (r.state_id !== null && o.orders.canceledStates.includes(r.state_id)) return false
  if (r.ceneo_writes?.cancel || r.ceneo_writes?.canceled_by_ceneo_at) return false
  await mergeWrites(sqlOf(scope), r.id, { cancel: { reason: o.orders.cancelReason, queued_at: new Date().toISOString() } }, { due: true })
  return true
}
