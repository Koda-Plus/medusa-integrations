/**
 * WHAT HAPPENS TO AN ISSUED DOCUMENT AFTERWARDS: the e-mail to the buyer and
 * the reaction to a canceled order. Used right after issuing, by the order
 * canceled subscriber and by the status job that retries what had to wait.
 *
 * E-MAIL (`sendByEmail`). Fakturownia sends the document to its
 * `buyer_email` (`POST /invoices/{id}/send_by_email.json`). On a KSeF account
 * a company document can be e-mailed only after its KSeF number arrives; the
 * refusal comes as HTTP 200 with `status: "error"` and "brak numeru KSeF", so
 * the e-mail stays `pending` and the status job tries again, for up to three
 * days. A request that got no answer may have sent the e-mail, so it is
 * never repeated blindly: the e-mail becomes `failed` with that note.
 *
 * CANCELED ORDER (`cancelOnOrderCanceled`, default true). A proforma is set
 * to "rejected" in Fakturownia (`change_status`): its number stays, nothing
 * can be paid against it, and unlike `cancel.json` this works also when it is
 * the last document of the numbering (measured in production). A VAT invoice
 * or a receipt is an accounting document: it only becomes `needs_correction`
 * for a person, who issues the correction in Fakturownia. The plugin never
 * corrects, deletes or cancels an accounting document.
 */

import { EMAIL_RETRY_DAYS, PLUGIN_EVENTS } from "../../modules/fakturownia/lib/constants"
import { toDate, type DocumentRow } from "../../modules/fakturownia/lib/dto"
import { describeError, FakturowniaApiError } from "../../modules/fakturownia/lib/errors"
import { isWaitingForKsef } from "../../modules/fakturownia/lib/status"
import { clientFor, emitEvent, fakturowniaService, patchDocument, storeFor, type Scope } from "./runtime"

export type EmailOutcome = "sent" | "waiting" | "failed" | "skipped"

export async function sendEmailFor(scope: Scope, row: DocumentRow): Promise<EmailOutcome> {
  const svc = fakturowniaService(scope)
  if (row.email_status !== "pending" || row.status !== "issued" || !row.fakturownia_id) return "skipped"
  const now = new Date()
  if (svc.isDemo()) {
    await patchDocument(svc, row.id, { email_status: "sent", emailed_at: now, email_error: null })
    return "sent"
  }
  try {
    await clientFor(svc).sendByEmail(row.fakturownia_id)
    await patchDocument(svc, row.id, { email_status: "sent", emailed_at: now, email_error: null })
    return "sent"
  } catch (err) {
    const d = describeError(err)
    const message = svc.mask(d.message).slice(0, 1000)
    const issuedAt = toDate(row.issued_at) ?? now
    const tooOld = now.getTime() - issuedAt.getTime() > EMAIL_RETRY_DAYS * 24 * 3600 * 1000
    const refusedTransient = err instanceof FakturowniaApiError && err.transient && err.refused
    if ((isWaitingForKsef(message) || refusedTransient) && !tooOld) {
      await patchDocument(svc, row.id, { email_error: message })
      return "waiting"
    }
    const note =
      err instanceof FakturowniaApiError && err.transient && !err.refused
        ? `${message} The e-mail may have gone out; it is not sent again automatically. Check the document in Fakturownia.`
        : message
    await patchDocument(svc, row.id, { email_status: "failed", email_error: note.slice(0, 1000) })
    return "failed"
  }
}

/** Sets an issued proforma to "rejected" in Fakturownia, then cancels the row. */
export async function rejectProforma(scope: Scope, row: DocumentRow): Promise<boolean> {
  const svc = fakturowniaService(scope)
  if (row.kind !== "proforma" || row.status !== "issued") return false
  const store = storeFor(scope)
  const done = {
    status: "canceled",
    cancel_requested_at: null,
    error: "Rejected in Fakturownia: the order was canceled. The proforma keeps its number.",
    error_code: "proforma_rejected",
  } as const
  if (svc.isDemo() || !row.fakturownia_id) {
    return Boolean(await store.transition(row.id, ["issued"], done))
  }
  try {
    await clientFor(svc).changeStatus(row.fakturownia_id, "rejected")
    return Boolean(await store.transition(row.id, ["issued"], done))
  } catch (err) {
    const d = describeError(err)
    if (err instanceof FakturowniaApiError && err.status === 404) {
      return Boolean(
        await store.transition(row.id, ["issued"], { ...done, error: "The order was canceled and the proforma is no longer in Fakturownia.", error_code: "remote_missing" }),
      )
    }
    const message = svc.mask(d.message).slice(0, 1000)
    /* Transient: the status job tries again. Refused (422...): a person decides, the request is cleared. */
    await patchDocument(svc, row.id, {
      error: `The order was canceled, but the proforma could not be rejected: ${message}`,
      error_code: "reject_failed",
      ...(d.retryable ? {} : { cancel_requested_at: null }),
    })
    return false
  }
}

/** The reaction to a canceled order, for one issued row. */
export async function applyCancelRule(scope: Scope, row: DocumentRow): Promise<"rejected" | "needs_correction" | "none"> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  if (row.status !== "issued" || !o.cancelOnOrderCanceled) return "none"
  if (row.kind === "proforma") {
    if (!row.cancel_requested_at) await patchDocument(svc, row.id, { cancel_requested_at: new Date() })
    return (await rejectProforma(scope, { ...row, cancel_requested_at: row.cancel_requested_at ?? new Date() })) ? "rejected" : "none"
  }
  const moved = await storeFor(scope).transition(row.id, ["issued"], {
    status: "needs_correction",
    cancel_requested_at: new Date(),
    error:
      row.kind === "receipt"
        ? "The order was canceled after this receipt was issued. Record the return or issue the correction in Fakturownia; the plugin never changes accounting documents."
        : "The order was canceled after this invoice was issued. Issue a correction invoice in Fakturownia; the plugin never changes accounting documents.",
    error_code: "order_canceled",
  })
  if (!moved) return "none"
  await emitEvent(scope, PLUGIN_EVENTS.documentNeedsAttention, {
    order_id: row.order_id,
    display_id: row.display_id,
    document_id: row.id,
    kind: row.kind,
    number: row.number,
    status: "needs_correction",
    demo: Boolean(row.demo),
  })
  return "needs_correction"
}
