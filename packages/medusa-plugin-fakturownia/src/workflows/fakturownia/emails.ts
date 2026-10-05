/**
 * E-MAILING DOCUMENTS, WITH A HISTORY.
 *
 * Fakturownia sends the e-mail itself (`send_by_email`); the plugin asks for
 * it and remembers who asked, when, to which address (masked) and what
 * Fakturownia answered.
 *
 *   auto      after issue, with `sendByEmail` (0.1.0; `writers.emails: false`
 *             stops it too). On a KSeF account a company document waits for
 *             its KSeF number; the status job tries again for three days.
 *   manual    a person, from the admin or the order page: to the buyer's
 *             address on the document, or to other addresses (up to five),
 *             with the PDF attached or not. Needs the e-mails writer armed.
 *   reminder  an unpaid proforma or VAT invoice e-mailed again (the API has no
 *             reminder call and no field for a custom text), at most once a
 *             day per document. Needs the e-mails writer armed.
 *
 * A request that got no answer may have sent the e-mail, so it is never
 * repeated by the plugin: the history says so and a person decides.
 *
 * DEMO MODE: the simulated mailbox. Nothing is sent; the history shows what
 * would have gone out, with a subject like Fakturownia's template.
 */

import { REMINDER_MIN_INTERVAL_HOURS } from "../../modules/fakturownia/lib/constants"
import { canRemind, demoSubject, maskEmail, maskEmailsIn, parseRecipients } from "../../modules/fakturownia/lib/email"
import { toDate, type DocumentRow, type EmailRow } from "../../modules/fakturownia/lib/dto"
import { describeError, FakturowniaApiError } from "../../modules/fakturownia/lib/errors"
import { isWaitingForKsef } from "../../modules/fakturownia/lib/status"
import { ActionError, clientFor, fakturowniaService, getDocument, isArmed, loadOrder, patchDocument, type Scope } from "./runtime"

export type EmailKind = "auto" | "manual" | "reminder"

/** The buyer's address of a document, masked, for the history. Null when it cannot be read. */
async function buyerAddress(scope: Scope, row: DocumentRow): Promise<string | null> {
  const svc = fakturowniaService(scope)
  try {
    if (row.demo) return maskEmail((await loadOrder(scope, row.order_id))?.email ?? null)
    const doc = await clientFor(svc).getInvoice(String(row.fakturownia_id), ["id", "buyer_email"])
    return typeof doc.buyer_email === "string" && doc.buyer_email.trim() ? maskEmail(doc.buyer_email) : null
  } catch {
    return null
  }
}

/** One line of the history. The address is masked before it gets here. */
export async function recordEmail(
  scope: Scope,
  row: DocumentRow,
  entry: { kind: EmailKind; status: "sent" | "failed" | "refused"; recipient: string | null; cc?: string | null; withPdf: boolean; error?: string | null; requestedBy: string | null },
): Promise<EmailRow> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  return (await svc.createFakturowniaEmails({
    document_id: row.id,
    order_id: row.order_id,
    demo: Boolean(row.demo),
    kind: entry.kind,
    status: entry.status,
    recipient: entry.recipient,
    cc: entry.cc ?? null,
    with_pdf: entry.withPdf,
    subject: row.demo ? demoSubject(row.kind, row.number, entry.kind, o.lang) : null,
    error: entry.error ? svc.mask(maskEmailsIn(entry.error)).slice(0, 1000) : null,
    requested_by: entry.requestedBy,
  } as never)) as unknown as EmailRow
}

/** The newest reminder that went out for a document. */
export async function lastReminder(scope: Scope, documentId: string): Promise<EmailRow | null> {
  const svc = fakturowniaService(scope)
  const rows = (await svc.listFakturowniaEmails({ document_id: documentId, kind: "reminder", status: "sent" } as never, {
    take: 1,
    order: { created_at: "DESC" },
  } as never)) as unknown as EmailRow[]
  return rows[0] ?? null
}

export interface SendEmailInput {
  kind: "manual" | "reminder"
  /** Other addresses than the buyer's: up to five, separated by commas. */
  to?: string | null
  /** Attach the PDF; the `emailPdf` option when not given. */
  attachPdf?: boolean | null
  actorId: string | null
}

export interface SendEmailResult {
  outcome: "sent" | "refused" | "failed"
  message: string | null
  email: EmailRow
  row: DocumentRow
}

/**
 * "Send by e-mail" and "Send a reminder" from the admin. Throws
 * `ActionError` for what a person must fix first (the writer is off, a wrong
 * address, a reminder sent less than a day ago); Fakturownia's own refusals
 * (no KSeF number yet, no buyer e-mail) come back as `refused`, recorded.
 */
export async function sendDocumentEmail(scope: Scope, documentId: string, input: SendEmailInput): Promise<SendEmailResult> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const row = await getDocument(svc, documentId)
  if (!row || Boolean(row.demo) !== svc.isDemo()) throw new ActionError(404, "Document not found.")
  if ((row.status !== "issued" && row.status !== "needs_correction") || !row.fakturownia_id) throw new ActionError(409, "Only a document issued in Fakturownia can be e-mailed.")
  if (!(await isArmed(svc, "emails"))) {
    throw new ActionError(
      409,
      o.writers.emails === false
        ? "E-mails are turned off in the plugin options (writers.emails: false)."
        : "The e-mails writer is off: turn it on in the Fakturownia page of the admin first.",
    )
  }
  const recipients = parseRecipients(input.to ?? "")
  if (recipients.invalid.length > 0) throw new ActionError(400, `Not e-mail addresses (or more than five): ${recipients.invalid.map((x) => maskEmail(x)).join(", ")}.`)
  const now = new Date()
  if (input.kind === "reminder") {
    if (row.paid || (row.kind !== "proforma" && row.kind !== "vat")) throw new ActionError(409, "A reminder is for an unpaid proforma or VAT invoice.")
    const last = await lastReminder(scope, row.id)
    if (!canRemind(toDate(last?.created_at), now, REMINDER_MIN_INTERVAL_HOURS)) throw new ActionError(409, "A reminder of this document went out less than a day ago.")
  }
  const withPdf = input.attachPdf ?? o.emailPdf
  const recipient = recipients.valid.length > 0 ? recipients.valid.map(maskEmail).join(", ") : await buyerAddress(scope, row)
  const base = { kind: input.kind as EmailKind, recipient, withPdf, requestedBy: input.actorId }

  if (row.demo) {
    const email = await recordEmail(scope, row, { ...base, status: "sent" })
    const updated = await patchDocument(svc, row.id, { emailed_at: now })
    return { outcome: "sent", message: null, email, row: updated }
  }
  try {
    await clientFor(svc).sendByEmail(row.fakturownia_id, { to: recipients.valid, pdf: withPdf })
    const email = await recordEmail(scope, row, { ...base, status: "sent" })
    const updated = await patchDocument(svc, row.id, { emailed_at: now })
    svc.getLogger().info(`[fakturownia] ${row.number ?? row.id} e-mailed (${input.kind}) to ${recipient ?? "the buyer"}`)
    return { outcome: "sent", message: null, email, row: updated }
  } catch (err) {
    const d = describeError(err)
    const message = svc.mask(maskEmailsIn(d.message)).slice(0, 1000)
    const unknown = err instanceof FakturowniaApiError && err.transient && !err.refused
    const refused = !unknown && (isWaitingForKsef(message) || (err instanceof FakturowniaApiError && err.refused))
    const note = unknown ? `${message} The e-mail may have gone out; it is not sent again automatically. Check the document in Fakturownia.` : message
    const email = await recordEmail(scope, row, { ...base, status: refused ? "refused" : "failed", error: note })
    return { outcome: refused ? "refused" : "failed", message: note, email, row }
  }
}

export type AutoEmailOutcome = "sent" | "waiting" | "failed" | "skipped"

/**
 * The automatic e-mail after issue (`sendByEmail`): sent once, waiting while
 * a company document has no KSeF number yet (for up to three days), recorded
 * in the history when it went out or failed for good.
 */
export async function sendAutoEmail(scope: Scope, row: DocumentRow, retryDays: number): Promise<AutoEmailOutcome> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  if (row.email_status !== "pending" || row.status !== "issued" || !row.fakturownia_id) return "skipped"
  const now = new Date()
  if (o.writers.emails === false) {
    await patchDocument(svc, row.id, { email_status: null, email_error: "E-mails are turned off in the plugin options (writers.emails: false)." })
    return "skipped"
  }
  const base = { kind: "auto" as const, recipient: await buyerAddress(scope, row), withPdf: o.emailPdf, requestedBy: "system" }
  if (row.demo) {
    await recordEmail(scope, row, { ...base, status: "sent" })
    await patchDocument(svc, row.id, { email_status: "sent", emailed_at: now, email_error: null })
    return "sent"
  }
  try {
    await clientFor(svc).sendByEmail(row.fakturownia_id, { pdf: o.emailPdf })
    await recordEmail(scope, row, { ...base, status: "sent" })
    await patchDocument(svc, row.id, { email_status: "sent", emailed_at: now, email_error: null })
    return "sent"
  } catch (err) {
    const d = describeError(err)
    const message = svc.mask(maskEmailsIn(d.message)).slice(0, 1000)
    const issuedAt = toDate(row.issued_at) ?? now
    const tooOld = now.getTime() - issuedAt.getTime() > retryDays * 24 * 3600 * 1000
    const refusedTransient = err instanceof FakturowniaApiError && err.transient && err.refused
    if ((isWaitingForKsef(message) || refusedTransient) && !tooOld) {
      await patchDocument(svc, row.id, { email_error: message })
      return "waiting"
    }
    const note =
      err instanceof FakturowniaApiError && err.transient && !err.refused
        ? `${message} The e-mail may have gone out; it is not sent again automatically. Check the document in Fakturownia.`
        : message
    await recordEmail(scope, row, { ...base, status: "failed", error: note })
    await patchDocument(svc, row.id, { email_status: "failed", email_error: note.slice(0, 1000) })
    return "failed"
  }
}
