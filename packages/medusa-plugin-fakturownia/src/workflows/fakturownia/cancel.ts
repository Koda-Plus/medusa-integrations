/**
 * A CANCELED ORDER.
 *
 *   pending, failed   no document exists: the row is canceled (always, also
 *                     with `cancelOnOrderCanceled: false`: a canceled order is
 *                     never invoiced)
 *   issuing, unknown  a document may exist: the row remembers the cancel;
 *                     the attempt or the reconciliation decides once it knows
 *   issued            with `cancelOnOrderCanceled` (default): a proforma is
 *                     rejected in Fakturownia, a VAT invoice or a receipt
 *                     becomes `needs_correction` for a person
 */

import { applyCancelRule } from "./followups"
import { documentsOfOrder, fakturowniaService, patchDocument, storeFor, type Scope } from "./runtime"

export interface CancelStats {
  canceled: number
  remembered: number
  rejected: number
  needsCorrection: number
}

export async function handleOrderCanceled(scope: Scope, orderId: string): Promise<CancelStats> {
  const svc = fakturowniaService(scope)
  const store = storeFor(scope)
  const stats: CancelStats = { canceled: 0, remembered: 0, rejected: 0, needsCorrection: 0 }
  const rows = await documentsOfOrder(svc, orderId)
  for (const row of rows) {
    /* A correction is not canceled with its order: it corrects a document that stays issued (a cancellation is planned as one more correction). */
    if (row.kind === "correction") continue
    if (row.status === "pending" || row.status === "failed") {
      const moved = await store.transition(row.id, ["pending", "failed"], {
        status: "canceled",
        next_attempt_at: null,
        error: "The order was canceled before the document was issued.",
        error_code: "order_canceled",
      })
      if (moved) stats.canceled += 1
      continue
    }
    if (row.status === "issuing" || row.status === "unknown") {
      await patchDocument(svc, row.id, { cancel_requested_at: new Date() })
      stats.remembered += 1
      continue
    }
    if (row.status === "issued") {
      const r = await applyCancelRule(scope, row)
      if (r === "rejected") stats.rejected += 1
      else if (r === "needs_correction") stats.needsCorrection += 1
    }
  }
  if (rows.length > 0) {
    svc
      .getLogger()
      .info(
        `[fakturownia] order ${orderId} canceled: ${stats.canceled} queued document(s) canceled, ${stats.rejected} proforma(s) rejected, ${stats.needsCorrection} need a correction`,
      )
  }
  return stats
}
