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
import { onOrderChanged } from "./corrections"
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

/**
 * `order.canceled`: queued documents are canceled, issued ones follow
 * `cancelOnOrderCanceled`, and (with `corrections: "plan"`) an issued VAT
 * invoice gets a correction to zero planned for a person to approve.
 */
export async function onOrderCanceled(scope: Scope, orderId: string): Promise<void> {
  try {
    if (!fakturowniaService(scope).isConfigured()) return
    await handleOrderCanceled(scope, orderId)
    await onOrderChanged(scope, orderId, { type: "cancel", id: orderId, at: new Date().toISOString() })
  } catch (err) {
    logError(scope, `order.canceled ${orderId}`, err)
  }
}

/** `order.return_received`: the returned goods may need a correction. Plans only; nothing goes to Fakturownia. */
export async function onReturnReceived(scope: Scope, orderId: string, returnId: string | null): Promise<void> {
  if (!fakturowniaService(scope).isConfigured()) return
  await onOrderChanged(scope, orderId, { type: "return", id: returnId || `return_of_${orderId}`, at: new Date().toISOString() })
}

/** `order-edit.confirmed`: quantities or prices of the order changed. Plans only. */
export async function onOrderEditConfirmed(scope: Scope, orderId: string, changeId: string | null): Promise<void> {
  if (!fakturowniaService(scope).isConfigured()) return
  await onOrderChanged(scope, orderId, { type: "edit", id: changeId || `edit_of_${orderId}`, at: new Date().toISOString() })
}

/** The newest refund of a payment and its order. Null for payments outside an order (claims, exchanges). */
export async function refundOfPayment(scope: Scope, paymentId: string): Promise<{ orderId: string; refundId: string | null } | null> {
  const orderId = await orderIdOfPayment(scope, paymentId)
  if (!orderId) return null
  const { data } = await queryOf(scope).graph({ entity: "payment", fields: ["id", "refunds.id", "refunds.created_at"], filters: { id: paymentId } })
  const refunds = ((data[0] as { refunds?: Array<{ id?: string; created_at?: string | Date | null }> | null } | undefined)?.refunds ?? []).filter((r) => r?.id)
  refunds.sort((a, b) => new Date(String(a.created_at ?? 0)).getTime() - new Date(String(b.created_at ?? 0)).getTime())
  return { orderId, refundId: refunds.length > 0 ? String(refunds[refunds.length - 1].id) : null }
}

/** `payment.refunded` (`{ id }` is the payment): a refund may be a price reduction or pay back a return. Plans only. */
export async function onPaymentRefunded(scope: Scope, paymentId: string): Promise<void> {
  try {
    if (!fakturowniaService(scope).isConfigured()) return
    const found = await refundOfPayment(scope, paymentId)
    if (!found) return
    await onOrderChanged(scope, found.orderId, { type: "refund", id: found.refundId || `refund_of_${paymentId}`, at: new Date().toISOString() })
  } catch (err) {
    logError(scope, `payment.refunded ${paymentId}`, err)
  }
}
