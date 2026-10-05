/**
 * KSeF IN DEPTH: the history of a document's KSeF status, "send to KSeF
 * again", and the KSeF XML and UPO of an accepted document.
 *
 * Fakturownia sends documents to KSeF by the account's setting (automatic
 * sending for companies, or for everybody); the plugin reads what happened
 * (`gov_status`, `gov_id`, `gov_send_date`, `gov_error_messages`,
 * `gov_verification_link`, `gov_corrected_invoice_number`) and keeps every
 * change it saw as a line of history.
 *
 * SEND AGAIN (`GET /invoices/{id}.json?send_to_ksef=yes`, KSeF.md): for a
 * document never sent, a send error, a KSeF server error (Fakturownia does
 * not retry those by itself), an offline document, or a connection or
 * permission problem fixed in Fakturownia. Not for `status_check_error` (the
 * invoice may be accepted already) or `duplicate_error`. Needs the KSeF
 * writer armed; once per five minutes per document; one request, never
 * repeated by the plugin.
 *
 * DEMO MODE simulates it all: "processing" becomes "accepted" a few minutes
 * after issue or after a "send again", a rejected document stays rejected
 * until someone sends it again, and the UPO is a simulated XML.
 */

import { KSEF_RESEND_MIN_INTERVAL_MS } from "../../modules/fakturownia/lib/constants"
import { demoGovId, demoKsefMinutes } from "../../modules/fakturownia/lib/demo"
import { toDate, type DocumentRow, type KsefEventRow } from "../../modules/fakturownia/lib/dto"
import { describeError, FakturowniaApiError } from "../../modules/fakturownia/lib/errors"
import { toRemoteDocument, type RemoteDocument } from "../../modules/fakturownia/lib/exactly-once"
import { pdfFileName } from "../../modules/fakturownia/lib/pdf"
import { baseGovStatus, canResendKsef, goesToKsef, govState } from "../../modules/fakturownia/lib/status"
import type { DocumentPatch } from "../../modules/fakturownia/lib/store"
import { ActionError, clientFor, fakturowniaService, getDocument, isArmed, patchDocument, type Scope } from "./runtime"

export type KsefEventSource = "issue" | "refresh" | "resend" | "demo"

/** One line of a document's KSeF history. Error messages are masked before they are stored. */
export async function recordKsefEvent(
  scope: Scope,
  row: Pick<DocumentRow, "id" | "order_id" | "demo">,
  entry: { source: KsefEventSource; govStatus: string | null; govId?: string | null; errors?: string[] | null; requestedBy?: string | null; note?: string | null; at?: Date },
): Promise<KsefEventRow | null> {
  const svc = fakturowniaService(scope)
  try {
    return (await svc.createFakturowniaKsefEvents({
      document_id: row.id,
      order_id: row.order_id,
      demo: Boolean(row.demo),
      source: entry.source,
      gov_status: entry.govStatus,
      gov_id: entry.govId ?? null,
      errors: entry.errors && entry.errors.length > 0 ? entry.errors.map((e) => svc.mask(e).slice(0, 500)) : null,
      requested_by: entry.requestedBy ?? null,
      note: entry.note ? svc.mask(entry.note).slice(0, 1000) : null,
      ...(entry.at ? { created_at: entry.at } : {}),
    } as never)) as unknown as KsefEventRow
  } catch (err) {
    svc.getLogger().warn(`[fakturownia] KSeF history of ${row.id}: ${svc.mask((err as Error)?.message ?? String(err))}`)
    return null
  }
}

/** The KSeF fields of a Fakturownia answer as a row patch (errors masked). */
export function govPatch(doc: RemoteDocument, mask: (t: string) => string, now: Date): DocumentPatch {
  return {
    gov_status: doc.govStatus,
    gov_id: doc.govId,
    gov_error: doc.govErrors ? mask(doc.govErrors).slice(0, 1000) : null,
    gov_errors: doc.govErrorList.length > 0 ? doc.govErrorList.map((e) => mask(e).slice(0, 500)) : null,
    gov_send_date: doc.govSendDate ? new Date(doc.govSendDate) : null,
    gov_verification_link: doc.govVerificationLink,
    gov_link: doc.govLink,
    gov_corrected_number: doc.govCorrectedNumber,
    gov_checked_at: now,
  }
}

/** Whether a status read is worth a line of history: the status, the number or the errors changed. */
export function ksefChanged(row: Pick<DocumentRow, "gov_status" | "gov_id" | "gov_error">, next: { govStatus: string | null; govId: string | null; govError: string | null }): boolean {
  return (row.gov_status ?? null) !== (next.govStatus ?? null) || (row.gov_id ?? null) !== (next.govId ?? null) || (row.gov_error ?? null) !== (next.govError ?? null)
}

/* ------------------------------------------------------------------ */
/* Send again                                                          */
/* ------------------------------------------------------------------ */

/** Why "send to KSeF again" is not offered for a status, for the admin. */
export function resendRefusal(govStatus: string | null): string | null {
  const s = baseGovStatus(govStatus)
  if (canResendKsef(govStatus)) return null
  if (s === "ok") return "KSeF accepted this document already."
  if (s === "processing") return "The document is on its way to KSeF; wait for the answer."
  if (s === "status_check_error") return "KSeF may have accepted this document already (the status check failed). Check it in Fakturownia before sending it again there."
  if (s === "duplicate_error") return "KSeF holds a document with this number already. Check it in Fakturownia; sending again cannot help."
  if (s === "not_applicable") return "This kind of document does not go to KSeF."
  return "This KSeF status cannot be sent again from the plugin."
}

export interface ResendResult {
  row: DocumentRow
  outcome: "sent" | "failed"
  message: string | null
}

/** "Send to KSeF again" from the admin. Throws `ActionError` for what a person must fix first. */
export async function resendToKsef(scope: Scope, documentId: string, actorId: string | null): Promise<ResendResult> {
  const svc = fakturowniaService(scope)
  const o = svc.getOptions()
  const row = await getDocument(svc, documentId)
  if (!row || Boolean(row.demo) !== svc.isDemo()) throw new ActionError(404, "Document not found.")
  if (!goesToKsef(row.kind)) throw new ActionError(409, "Only VAT invoices and corrections go to KSeF.")
  if ((row.status !== "issued" && row.status !== "needs_correction") || !row.fakturownia_id) throw new ActionError(409, "Only a document issued in Fakturownia can be sent to KSeF.")
  const refusal = resendRefusal(row.gov_status)
  if (refusal) throw new ActionError(409, refusal)
  if (!(await isArmed(svc, "ksef"))) {
    throw new ActionError(
      409,
      o.writers.ksef === false
        ? "Sending to KSeF is turned off in the plugin options (writers.ksef: false)."
        : "The KSeF writer is off: turn it on in the Fakturownia page of the admin first.",
    )
  }
  const now = new Date()
  const last = toDate(row.ksef_resend_at)
  if (last && now.getTime() - last.getTime() < KSEF_RESEND_MIN_INTERVAL_MS) throw new ActionError(409, "This document was sent to KSeF again less than five minutes ago. Wait for the answer.")

  if (row.demo) {
    const updated = await patchDocument(svc, row.id, { gov_status: "processing", gov_error: null, gov_errors: null, ksef_resend_at: now, gov_send_date: now, gov_checked_at: now })
    await recordKsefEvent(scope, row, { source: "resend", govStatus: "processing", requestedBy: actorId, note: "Simulated: sent to the simulated KSeF again." })
    return { row: updated, outcome: "sent", message: null }
  }
  try {
    const answer = toRemoteDocument(await clientFor(svc).sendToKsef(row.fakturownia_id))
    const patch: DocumentPatch = answer ? { ...govPatch(answer, (t) => svc.mask(t), now), ksef_resend_at: now } : { ksef_resend_at: now, gov_checked_at: now }
    const updated = await patchDocument(svc, row.id, patch)
    await recordKsefEvent(scope, row, { source: "resend", govStatus: answer?.govStatus ?? null, govId: answer?.govId ?? null, errors: answer?.govErrorList ?? null, requestedBy: actorId })
    return { row: updated, outcome: "sent", message: null }
  } catch (err) {
    const message = svc.mask(describeError(err).message).slice(0, 1000)
    await patchDocument(svc, row.id, { ksef_resend_at: now })
    await recordKsefEvent(scope, row, { source: "resend", govStatus: row.gov_status, requestedBy: actorId, note: `Failed: ${message}` })
    return { row: (await getDocument(svc, row.id)) ?? row, outcome: "failed", message }
  }
}

/* ------------------------------------------------------------------ */
/* The KSeF XML and the UPO                                            */
/* ------------------------------------------------------------------ */

export interface KsefFile {
  filename: string
  contentType: string
  data: Buffer
}

function xmlText(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** The simulated file of a demo document: plain XML that says it is a simulation. */
export function demoKsefXml(row: Pick<DocumentRow, "number" | "gov_id" | "gov_send_date" | "issue_date" | "total_gross" | "currency">, file: "upo" | "xml"): string {
  const at = toDate(row.gov_send_date)?.toISOString() ?? new Date().toISOString()
  const lines =
    file === "upo"
      ? [
          `<DemoUpo>`,
          `  <Note>Simulation: a demo document of a simulated Fakturownia account, never sent to KSeF.</Note>`,
          `  <KsefNumber>${xmlText(row.gov_id ?? "")}</KsefNumber>`,
          `  <InvoiceNumber>${xmlText(row.number ?? "")}</InvoiceNumber>`,
          `  <AcceptedAt>${at}</AcceptedAt>`,
          `</DemoUpo>`,
        ]
      : [
          `<DemoInvoice>`,
          `  <Note>Simulation: a demo document of a simulated Fakturownia account, never sent to KSeF.</Note>`,
          `  <KsefNumber>${xmlText(row.gov_id ?? "")}</KsefNumber>`,
          `  <InvoiceNumber>${xmlText(row.number ?? "")}</InvoiceNumber>`,
          `  <IssueDate>${xmlText(row.issue_date ?? "")}</IssueDate>`,
          `  <Gross currency="${xmlText(row.currency ?? "PLN")}">${row.total_gross ?? ""}</Gross>`,
          `</DemoInvoice>`,
        ]
  return `<?xml version="1.0" encoding="UTF-8"?>\n${lines.join("\n")}\n`
}

/** The KSeF XML or the UPO of an accepted document: fetched by the backend, never by the browser. */
export async function ksefFile(scope: Scope, row: DocumentRow, file: "upo" | "xml"): Promise<KsefFile> {
  const svc = fakturowniaService(scope)
  if (!row.fakturownia_id || !goesToKsef(row.kind) || govState(row.gov_status) !== "accepted") {
    throw new ActionError(409, "KSeF has not accepted this document (yet), so there is no KSeF XML or UPO.")
  }
  const base = pdfFileName(row.number, `document-${row.fakturownia_id}`).replace(/\.pdf$/, "")
  const filename = `${file === "upo" ? "UPO" : "KSeF"}-${base}.xml`
  if (row.demo) return { filename, contentType: "application/xml; charset=utf-8", data: Buffer.from(demoKsefXml(row, file), "utf8") }
  try {
    const got = await clientFor(svc).getAttachment(row.fakturownia_id, file === "upo" ? "gov_upo" : "gov")
    return { filename, contentType: got.contentType || "application/xml", data: Buffer.from(got.bytes) }
  } catch (err) {
    if (err instanceof FakturowniaApiError && err.status === 404) {
      throw new ActionError(404, "Fakturownia has no such file for this document yet: after a batch sending it can take up to an hour.")
    }
    throw new ActionError(502, svc.mask(describeError(err).message))
  }
}

/* ------------------------------------------------------------------ */
/* Demo: the simulated KSeF                                            */
/* ------------------------------------------------------------------ */

/**
 * Demo mode: the simulated KSeF status of a document now. "processing"
 * becomes "ok" a few minutes after the document was issued or sent again;
 * every other status stays (a rejection waits for "send again").
 */
export function demoKsefNext(row: Pick<DocumentRow, "id" | "kind" | "order_id" | "gov_status" | "issued_at" | "ksef_resend_at" | "issue_date">, now: Date): { govStatus: string; govId: string | null } | null {
  if (!goesToKsef(row.kind)) return null
  if (baseGovStatus(row.gov_status) !== "processing") return null
  const since = toDate(row.ksef_resend_at) ?? toDate(row.issued_at) ?? now
  if (now.getTime() < since.getTime() + demoKsefMinutes(row.order_id) * 60_000) return null
  const seed = row.kind === "correction" ? `${row.order_id}#${row.id}` : row.order_id
  return { govStatus: "ok", govId: demoGovId(seed, row.issue_date ?? now.toISOString().slice(0, 10)) }
}
