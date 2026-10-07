/**
 * INVOICE NUMBERS INTO BASELINKER ORDERS, exactly once per document.
 *
 * A soft dependency on the Fakturownia plugin of Koda Plus: it emits
 * `fakturownia.document.issued`, this plugin listens by name and never
 * imports the Fakturownia package. A row per document is written first
 * (unique per document id and mode); the `invoiceNumbers` writer, when
 * armed, reads the BaseLinker order, writes the number into the chosen field
 * when it is empty, adopts it when it is already there and stops at
 * `conflict` when the field holds another value. Nothing else is written.
 */

import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { planRetry } from "../../modules/baselinker/lib/backoff"
import { BACKOFF_SECONDS, INVOICES_PER_PASS, MAX_ATTEMPTS, PLUGIN_EVENTS } from "../../modules/baselinker/lib/constants"
import type { RunTrigger } from "../../modules/baselinker/lib/contract"
import type { ImportRow, InvoiceRow, OrderRow } from "../../modules/baselinker/lib/dto"
import { describeAnyError } from "../../modules/baselinker/lib/errors"
import { acceptDocument, decideInvoiceWrite, fieldValue, parseDocumentIssued } from "../../modules/baselinker/lib/invoice-numbers"
import { canWriteInvoiceNumbers } from "../../modules/baselinker/lib/options"
import { writerState } from "../../modules/baselinker/lib/writers"
import { baselinkerService, clientFor, emitEvent, exclusive, recordRun, withLock, type Scope } from "./runtime"
import { loadDemoState, loadWriters, updateDemoState } from "./settings"

/** Waiting for the order to reach BaseLinker: looked at again after this long. */
const EXPORT_WAIT_MS = 5 * 60 * 1000
const LEASE_MS = 10 * 60 * 1000

async function updateInvoice(svc: BaseLinkerModuleService, id: string, patch: Record<string, unknown>): Promise<void> {
  await svc.updateBaseLinkerInvoices({ id, ...patch } as never)
}

/** Where the Medusa order is in BaseLinker: sent by the outbox, imported from it, on its way, or not there. */
export async function blOrderFor(
  svc: BaseLinkerModuleService,
  orderId: string,
): Promise<{ state: "in" | "pending_export" | "absent"; blOrderId: string | null; displayId: number | null }> {
  const demo = svc.isDemo()
  const sent = (await svc.listBaseLinkerOrders({ order_id: orderId, demo } as never, { take: 1 } as never)) as unknown as OrderRow[]
  if (sent[0]?.bl_order_id) return { state: "in", blOrderId: sent[0].bl_order_id, displayId: sent[0].display_id }
  const imported = (await svc.listBaseLinkerImports({ order_id: orderId, demo } as never, { take: 1 } as never)) as unknown as ImportRow[]
  if (imported[0]) return { state: "in", blOrderId: imported[0].bl_order_id, displayId: imported[0].display_id }
  if (sent[0] && sent[0].status === "pending") return { state: "pending_export", blOrderId: null, displayId: sent[0].display_id }
  return { state: "absent", blOrderId: null, displayId: sent[0]?.display_id ?? null }
}

/** Demo mode: the order is one the demo created from a simulated marketplace order (its import row says so). */
async function demoCreatedOrder(svc: BaseLinkerModuleService, orderId: string): Promise<boolean> {
  const rows = (await svc.listBaseLinkerImports({ order_id: orderId, demo: true } as never, { take: 1, select: ["id"] } as never)) as unknown as unknown[]
  return rows.length > 0
}

/** The subscriber's half: a row per accepted document, before anything else. */
export async function recordInvoiceDocument(scope: Scope, raw: unknown): Promise<"queued" | "known" | "ignored"> {
  const svc = baselinkerService(scope)
  const o = svc.getOptions()
  if (!canWriteInvoiceNumbers(o)) return "ignored"
  const doc = parseDocumentIssued(raw)
  if (!doc) return "ignored"
  if (!acceptDocument(doc, { kinds: o.invoiceNumberKinds, demo: o.demo }).accept) return "ignored"
  const known = (await svc.listBaseLinkerInvoices({ document_id: doc.id, demo: o.demo } as never, { take: 1 } as never)) as unknown as InvoiceRow[]
  if (known[0]) return "known"
  const where = await blOrderFor(svc, doc.order_id)
  try {
    await svc.createBaseLinkerInvoices({
      document_id: doc.id,
      external_id: doc.external_id,
      order_id: doc.order_id,
      display_id: where.displayId,
      bl_order_id: where.blOrderId,
      kind: doc.kind,
      number: doc.number,
      field: o.invoiceNumberField,
      status: "pending",
      attempts: 0,
      next_attempt_at: new Date(),
      demo: o.demo,
    } as never)
    return "queued"
  } catch {
    return "known"
  }
}

export interface InvoiceOutcome {
  status: "written" | "adopted" | "conflict" | "skipped" | "waiting" | "retry" | "failed"
  message: string | null
}

async function writeOne(scope: Scope, row: InvoiceRow): Promise<InvoiceOutcome> {
  const svc = baselinkerService(scope)
  const o = svc.getOptions()
  const attempts = (row.attempts ?? 0) + 1
  await updateInvoice(svc, row.id, { attempts, next_attempt_at: new Date(Date.now() + LEASE_MS) })
  try {
    let blOrderId = row.bl_order_id
    if (!blOrderId) {
      const where = await blOrderFor(svc, row.order_id)
      if (where.state === "pending_export") {
        await updateInvoice(svc, row.id, { next_attempt_at: new Date(Date.now() + EXPORT_WAIT_MS), last_error: "The order is still on its way to BaseLinker.", last_error_code: "waiting" })
        return { status: "waiting", message: null }
      }
      if (where.state === "absent") {
        const message = "This order is not in BaseLinker (not sent and not imported), so there is no order to put the number on."
        await updateInvoice(svc, row.id, { status: "skipped", next_attempt_at: null, last_error: message, last_error_code: "not_in_baselinker" })
        return { status: "skipped", message }
      }
      blOrderId = where.blOrderId
      await updateInvoice(svc, row.id, { bl_order_id: blOrderId })
    }
    const number = row.number as string

    let current: string | null
    if (o.demo) current = (await loadDemoState(svc)).invoiceNumbers[blOrderId as string] ?? null
    else {
      const orders = await clientFor(svc).getOrders({ order_id: Number(blOrderId), get_unconfirmed_orders: true, include_custom_extra_fields: true })
      const order = orders.find((x) => String(x.order_id) === String(blOrderId))
      if (!order) {
        const message = `BaseLinker no longer returns order ${blOrderId}.`
        await updateInvoice(svc, row.id, { status: "skipped", next_attempt_at: null, last_error: message, last_error_code: "not_found" })
        return { status: "skipped", message }
      }
      current = fieldValue(order as Record<string, unknown>, row.field)
    }

    const decision = decideInvoiceWrite(current, number, row.field)
    if (decision === "conflict" || decision === "too_long") {
      const message =
        decision === "conflict"
          ? `The field ${row.field} of BaseLinker order ${blOrderId} already holds "${current}". Nothing was overwritten: clear it in BaseLinker, then retry.`
          : `The number has more than 50 characters, too long for ${row.field}: choose a custom extra field (invoiceNumberField).`
      await updateInvoice(svc, row.id, { status: "conflict", next_attempt_at: null, last_error: message, last_error_code: decision })
      return { status: "conflict", message }
    }
    if (decision === "write") {
      if (o.demo) {
        await updateDemoState(svc, (s) => {
          s.invoiceNumbers[blOrderId as string] = number
        })
      } else {
        await clientFor(svc).forWriter("invoiceNumbers").setOrderField(Number(blOrderId), row.field, number)
      }
    }
    await updateInvoice(svc, row.id, {
      status: "written",
      written_at: new Date(),
      next_attempt_at: null,
      last_error: decision === "adopt" ? "The number was already in BaseLinker: nothing written." : null,
      last_error_code: decision === "adopt" ? "adopted" : null,
    })
    /* Demo mode tells the event bus only about orders the demo created itself (demoCreatesOrders). */
    if (!o.demo || (await demoCreatedOrder(svc, row.order_id))) {
      await emitEvent(scope, PLUGIN_EVENTS.invoiceNumberWritten, {
        order_id: row.order_id,
        baselinker_order_id: blOrderId,
        number,
        field: row.field,
        adopted: decision === "adopt",
        demo: o.demo,
      })
    }
    return { status: decision === "adopt" ? "adopted" : "written", message: null }
  } catch (err) {
    const d = describeAnyError(err)
    const plan = planRetry({ attempts, retryable: d.retryable, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now: new Date() })
    const message = svc.mask(d.message).slice(0, 2000)
    await updateInvoice(svc, row.id, { status: plan.status, next_attempt_at: plan.nextAttemptAt, last_error: message, last_error_code: d.code })
    return { status: plan.status === "failed" ? "failed" : "retry", message }
  }
}

export interface InvoicePassStats {
  armed: boolean
  processed: number
  written: number
  adopted: number
  conflict: number
  skipped: number
  waiting: number
  retry: number
  failed: number
}

/** Writes the due numbers while the writer is armed. One pass at a time across every process; null when one already runs. */
export async function processDueInvoices(scope: Scope, trigger: RunTrigger): Promise<InvoicePassStats | null> {
  return exclusive(scope, "invoices", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const stats: InvoicePassStats = { armed: false, processed: 0, written: 0, adopted: 0, conflict: 0, skipped: 0, waiting: 0, retry: 0, failed: 0 }
    if (!canWriteInvoiceNumbers(o)) return stats
    const { writers } = await loadWriters(svc)
    stats.armed = writerState(writers, "invoiceNumbers").live
    if (!stats.armed) return stats
    const startedAt = new Date()
    const due = (await svc.listBaseLinkerInvoices({ status: "pending", demo: o.demo, next_attempt_at: { $lte: new Date() } } as never, {
      take: INVOICES_PER_PASS,
      order: { next_attempt_at: "ASC", created_at: "ASC" },
    } as never)) as unknown as InvoiceRow[]
    for (const row of due) {
      /* Read again under the lock: a row another process wrote or leased a moment ago gets no extra attempt. */
      const out = await withLock(scope, `baselinker:invoice:${row.document_id}`, async () => {
        const fresh = ((await svc.listBaseLinkerInvoices({ id: row.id } as never, { take: 1 } as never)) as unknown as InvoiceRow[])[0]
        const dueAt = fresh?.next_attempt_at ? new Date(fresh.next_attempt_at).getTime() : 0
        if (!fresh || fresh.status !== "pending" || dueAt > Date.now()) return null
        return writeOne(scope, fresh)
      })
      if (!out) continue
      stats.processed += 1
      stats[out.status === "written" ? "written" : out.status === "adopted" ? "adopted" : out.status] += 1
    }
    if (stats.processed > 0 && stats.processed !== stats.waiting) {
      await recordRun(svc, {
        kind: "invoices",
        trigger,
        status: stats.failed > 0 || stats.conflict > 0 ? "partial" : "ok",
        complete: true,
        startedAt,
        counts: { ...stats },
        message: `${stats.written} number(s) written, ${stats.adopted} already there, ${stats.conflict} conflict(s), ${stats.skipped} skipped.`,
      })
    }
    return stats
  })
}

/** "Retry" in the admin: back to the queue with fresh attempts, written now when the writer is armed. */
export async function retryInvoice(scope: Scope, id: string): Promise<InvoiceOutcome | null> {
  const svc = baselinkerService(scope)
  const rows = (await svc.listBaseLinkerInvoices({ id, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as InvoiceRow[]
  const row = rows[0]
  if (!row || row.status === "written") return null
  await updateInvoice(svc, row.id, { status: "pending", attempts: 0, next_attempt_at: new Date(), last_error: null, last_error_code: null })
  const { writers } = await loadWriters(svc)
  if (!writerState(writers, "invoiceNumbers").live) return { status: "waiting", message: "Queued: the invoice number writer is not armed." }
  const fresh = (await svc.listBaseLinkerInvoices({ id } as never, { take: 1 } as never)) as unknown as InvoiceRow[]
  return withLock(scope, `baselinker:invoice:${row.document_id}`, () => writeOne(scope, fresh[0]))
}
