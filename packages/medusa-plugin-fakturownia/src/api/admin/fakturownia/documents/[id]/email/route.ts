import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ActionResponse } from "../../../../../../modules/fakturownia/lib/contract"
import { sendDocumentEmail } from "../../../../../../workflows/fakturownia/emails"
import { ActionError, actorOf, documentDto, fakturowniaService } from "../../../helpers"

/**
 * POST /admin/fakturownia/documents/:id/email  { "kind": "manual" | "reminder", "to": "ksiegowosc@firma.pl", "attachPdf": true }
 *
 * Fakturownia e-mails the document: to the buyer's address on the document,
 * or to `to` (up to five addresses, separated by commas), with the PDF
 * attached when `attachPdf` (default: the `emailPdf` option). `reminder`
 * e-mails an unpaid proforma or VAT invoice again, at most once a day. Needs
 * the e-mails writer armed. Every request is recorded in the document's
 * history with the address masked. Demo mode: the simulated mailbox.
 *
 * 200 sent; 409 refused by Fakturownia (for instance no KSeF number yet) or
 * not possible now; 502 failed (the message says whether it may have gone out).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const input = (req.body ?? {}) as { kind?: unknown; to?: unknown; attachPdf?: unknown }
  const kind = input.kind === "reminder" ? "reminder" : "manual"
  try {
    const result = await sendDocumentEmail(req.scope, req.params.id, {
      kind,
      to: typeof input.to === "string" ? input.to : null,
      attachPdf: typeof input.attachPdf === "boolean" ? input.attachPdf : null,
      actorId: actorOf(req),
    })
    const body: ActionResponse = { document: documentDto(svc, result.row), outcome: result.outcome, message: result.message }
    res.status(result.outcome === "sent" ? 200 : result.outcome === "refused" ? 409 : 502).json(result.outcome === "sent" ? body : { ...body, message: result.message })
  } catch (err) {
    if (err instanceof ActionError) {
      res.status(err.status).json({ message: svc.mask(err.message) })
      return
    }
    throw err
  }
}
