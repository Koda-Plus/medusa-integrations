/**
 * THE ENTRY POINTS OF MEDUSA EVENTS. The subscribers are one line each and
 * call these, so a store can call them from its own code too.
 *
 * Every handler only INSERTS rows (`enqueueDue`) and starts a pass in the
 * background. It never fails the event: Fakturownia being down only makes
 * the queue longer.
 */

import { enqueueDue, kickIssue } from "./documents"
import { handleOrderCanceled } from "./cancel"
import { kickPayments, requestMarkPaid } from "./payments"
import { fakturowniaService, queryOf, type Scope } from "./runtime"

/** The order of a payment: payment, its payment collection, the collection's order (link). Null for claims and exchanges. */
export async function orderIdOfPayment(scope: Scope, paymentId: string): Promise<string | null> {
  const query = queryOf(scope)
  const { data: payments } = await query.graph({ entity: "payment", fields: ["id", "payment_collection_id"], filters: { id: paymentId } })
  const collectionId = (payments[0] as { payment_collection_id?: string | null } | undefined)?.payment_collection_id
  if (!collectionId) return null
  const { data: collections } = await query.graph({ entity: "payment_collection", fields: ["id", "order.id"], filters: { id: collectionId } })
  return (collections[0] as { order?: { id?: string | null } | null } | undefined)?.order?.id ?? null
}

function logError(scope: Scope, label: string, err: unknown): void {
  const svc = fakturowniaService(scope)
  svc.getLogger().error(`[fakturownia] ${label}: ${svc.mask((err as Error)?.message ?? String(err))}`)
}

/** `order.placed`: with `trigger: "order_placed"`, or an order paid during checkout, the first document is queued. */
export async function onOrderPlaced(scope: Scope, orderId: string): Promise<void> {
  try {
    if (!fakturowniaService(scope).isConfigured()) return
    const { inserted } = await enqueueDue(scope, orderId, "order_placed")
    if (inserted.length > 0) kickIssue(scope, "auto")
  } catch (err) {
    logError(scope, `order.placed ${orderId}`, err)
  }
}

/** `payment.captured`: the first document when the trigger is the capture, and unpaid documents become paid. */
export async function onPaymentCaptured(scope: Scope, paymentId: string): Promise<void> {
  try {
    const svc = fakturowniaService(scope)
    if (!svc.isConfigured()) return
    const orderId = await orderIdOfPayment(scope, paymentId)
    if (!orderId) return
    const { inserted } = await enqueueDue(scope, orderId, "payment_captured")
    if (inserted.length > 0) kickIssue(scope, "auto")
    if (svc.getOptions().markPaidOnCapture && (await requestMarkPaid(scope, orderId)) > 0) kickPayments(scope, "auto")
  } catch (err) {
    logError(scope, `payment.captured ${paymentId}`, err)
  }
}

/** `order.fulfillment_created`: in the proforma flow, the final document. */
export async function onOrderFulfilled(scope: Scope, orderId: string): Promise<void> {
  try {
    if (!fakturowniaService(scope).isConfigured()) return
    const { inserted } = await enqueueDue(scope, orderId, "fulfillment")
    if (inserted.length > 0) kickIssue(scope, "auto")
  } catch (err) {
    logError(scope, `order.fulfillment_created ${orderId}`, err)
  }
}

/** `order.canceled`: queued documents are canceled, issued ones follow `cancelOnOrderCanceled`. */
export async function onOrderCanceled(scope: Scope, orderId: string): Promise<void> {
  try {
    if (!fakturowniaService(scope).isConfigured()) return
    await handleOrderCanceled(scope, orderId)
  } catch (err) {
    logError(scope, `order.canceled ${orderId}`, err)
  }
}
