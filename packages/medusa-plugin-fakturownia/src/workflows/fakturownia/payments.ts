/**
 * UNPAID DOCUMENTS BECOME PAID (`markPaidOnCapture`, default true).
 *
 * A document issued before the money arrived (cash on delivery, a transfer,
 * `trigger: "order_placed"`, a final document after a proforma) is unpaid in
 * Fakturownia. When the payment of its order is captured in Medusa, the
 * `payment.captured` subscriber marks the order's documents
 * (`pay_requested_at`) and this pass sets them paid:
 *
 *   1. the order must be captured IN FULL; a partial capture waits for the
 *      next one;
 *   2. the document is read first (`price_gross`, `paid`): already paid in
 *      Fakturownia (a bank import, a person) means only the row is updated;
 *   3. a document whose amount differs from what was captured by more than
 *      two cents is NOT touched (measured in production: setting `paid` to
 *      the order total there makes it "partially paid"); the row says why
 *      and a person decides;
 *   4. otherwise `PUT /invoices/{id}.json` with `paid` only. Measured in
 *      production: `paid` works on proformas too, `status: "paid"` is
 *      refused there.
 *
 * Idempotent: setting the same paid amount twice is harmless, and the row
 * remembers it.
 */

import { AMOUNT_TOLERANCE, PAYMENTS_PER_PASS } from "../../modules/fakturownia/lib/constants"
import type { RunTrigger } from "../../modules/fakturownia/lib/contract"
import { paymentFacts } from "../../modules/fakturownia/lib/document"
import type { DocumentRow } from "../../modules/fakturownia/lib/dto"
import { describeError } from "../../modules/fakturownia/lib/errors"
import { toRemoteDocument } from "../../modules/fakturownia/lib/exactly-once"
import { amountText, money } from "../../modules/fakturownia/lib/numbers"
import { canIssue } from "../../modules/fakturownia/lib/options"
import { clientFor, documentsOfOrder, exclusive, fakturowniaService, inBackground, listDocuments, loadOrder, patchDocument, recordRun, type Scope } from "./runtime"

/** The payment of an order was captured: its unpaid documents are due to be marked paid. */
export async function requestMarkPaid(scope: Scope, orderId: string): Promise<number> {
  const svc = fakturowniaService(scope)
  if (!svc.getOptions().markPaidOnCapture || !canIssue(svc.getOptions())) return 0
  const rows = (await documentsOfOrder(svc, orderId)).filter((r) => r.kind !== "correction" && !r.paid && ["pending", "issuing", "issued", "unknown"].includes(r.status))
  const now = new Date()
  for (const r of rows) await patchDocument(svc, r.id, { pay_requested_at: now })
  return rows.length
}

export interface PaymentsStats {
  candidates: number
  marked: number
  alreadyPaid: number
  notCaptured: number
  mismatched: number
  errors: string[]
}

async function markOne(scope: Scope, row: DocumentRow, stats: PaymentsStats): Promise<void> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const now = new Date()
  const order = await loadOrder(scope, row.order_id)
  if (!order) {
    await patchDocument(svc, row.id, { pay_requested_at: null })
    return
  }
  const facts = paymentFacts(order.payment_collections ?? [], money(order.total), o.codProviders)
  if (!facts.captured) {
    /* A partial capture: the next capture event asks again. */
    stats.notCaptured += 1
    await patchDocument(svc, row.id, { pay_requested_at: null })
    return
  }
  if (o.demo || !row.fakturownia_id) {
    stats.marked += 1
    await patchDocument(svc, row.id, { paid: true, paid_at: now, pay_requested_at: null })
    return
  }
  try {
    const client = clientFor(svc)
    const doc = toRemoteDocument(await client.getInvoice(row.fakturownia_id, ["id", "number", "kind", "price_gross", "paid", "status"]))
    const gross = doc?.gross ?? null
    if (doc && gross !== null && doc.paid !== null && gross > 0 && doc.paid + 0.005 >= gross) {
      stats.alreadyPaid += 1
      await patchDocument(svc, row.id, { paid: true, paid_at: now, pay_requested_at: null })
      return
    }
    if (gross === null || Math.abs(gross - facts.amountCaptured) > AMOUNT_TOLERANCE) {
      stats.mismatched += 1
      await patchDocument(svc, row.id, {
        pay_requested_at: null,
        error: `Not marked paid: the document is ${gross ?? "?"} in Fakturownia, ${facts.amountCaptured} was captured. Mark it in Fakturownia if that is right.`,
        error_code: "amount_mismatch",
      })
      return
    }
    await client.markPaid(row.fakturownia_id, amountText(gross))
    stats.marked += 1
    await patchDocument(svc, row.id, { paid: true, paid_at: now, pay_requested_at: null, ...(row.error_code === "amount_mismatch" ? { error: null, error_code: null } : {}) })
  } catch (err) {
    const d = describeError(err)
    const message = svc.mask(d.message).slice(0, 500)
    if (stats.errors.length < 10) stats.errors.push(`#${row.display_id ?? row.order_id}: ${message}`)
    /* Transient: the request stays and the next pass tries again. Permanent: a person decides. */
    if (!d.retryable) await patchDocument(svc, row.id, { pay_requested_at: null, error: `Could not mark paid: ${message}`, error_code: "mark_paid_failed" })
  }
}

/** Marks paid the issued documents whose orders were captured. One pass per process at a time; null when one runs. */
export async function markPaidDue(scope: Scope, trigger: RunTrigger): Promise<PaymentsStats | null> {
  return exclusive("payments", async () => {
    const svc = fakturowniaService(scope)
    const o = svc.getOptions()
    const stats: PaymentsStats = { candidates: 0, marked: 0, alreadyPaid: 0, notCaptured: 0, mismatched: 0, errors: [] }
    if (!o.markPaidOnCapture || !canIssue(o)) return stats
    const startedAt = new Date()
    const rows = await listDocuments(svc, { demo: o.demo, status: "issued", paid: false, pay_requested_at: { $ne: null } }, {
      take: PAYMENTS_PER_PASS,
      order: { pay_requested_at: "ASC" },
    })
    stats.candidates = rows.length
    for (const row of rows) await markOne(scope, row, stats)

    if (rows.length > 0 || trigger === "manual") {
      await recordRun(svc, {
        kind: "payments",
        trigger,
        status: stats.errors.length > 0 ? (stats.marked + stats.alreadyPaid > 0 ? "partial" : "error") : stats.mismatched > 0 ? "partial" : "ok",
        complete: stats.errors.length === 0,
        startedAt,
        counts: { ...stats },
        message:
          stats.errors.length > 0
            ? stats.errors.slice(0, 3).join("; ")
            : `${stats.marked} marked paid, ${stats.alreadyPaid} already paid, ${stats.mismatched} with another amount.`,
      })
    }
    return stats
  })
}

/** Starts a payments pass in the background (the capture subscriber). */
export function kickPayments(scope: Scope, trigger: RunTrigger, tries = 3): void {
  inBackground(scope, "payments pass", async () => {
    const stats = await markPaidDue(scope, trigger)
    if (stats === null && tries > 1) setTimeout(() => kickPayments(scope, trigger, tries - 1), 5000).unref?.()
  })
}
