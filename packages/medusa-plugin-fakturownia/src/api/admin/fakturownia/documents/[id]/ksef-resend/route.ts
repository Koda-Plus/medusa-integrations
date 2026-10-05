import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ActionResponse } from "../../../../../../modules/fakturownia/lib/contract"
import { resendToKsef } from "../../../../../../workflows/fakturownia/ksef"
import { ActionError, actorOf, documentDto, fakturowniaService } from "../../../helpers"

/**
 * POST /admin/fakturownia/documents/:id/ksef-resend
 *
 * "Send to KSeF again": Fakturownia is asked to send the document to KSeF
 * (`GET /invoices/{id}.json?send_to_ksef=yes`), for a document never sent, a
 * send or KSeF server error, an offline document, or a connection or
 * permission problem fixed in Fakturownia. Not for `status_check_error` or
 * `duplicate_error` (the answer says what to do instead). Needs the KSeF
 * writer armed; once per five minutes per document; recorded in the
 * document's KSeF history with who asked. Demo mode: the simulated KSeF.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  try {
    const result = await resendToKsef(req.scope, req.params.id, actorOf(req))
    const body: ActionResponse = { document: documentDto(svc, result.row), outcome: result.outcome, message: result.message }
    res.status(result.outcome === "sent" ? 200 : 502).json(body)
  } catch (err) {
    if (err instanceof ActionError) {
      res.status(err.status).json({ message: svc.mask(err.message) })
      return
    }
    throw err
  }
}
