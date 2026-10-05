import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getDocument } from "../../../../../../workflows/fakturownia/runtime"
import { fakturowniaService, sendDocumentPdf } from "../../../helpers"

/**
 * GET /admin/fakturownia/documents/:id/pdf
 *
 * The PDF of an issued document, fetched server side and streamed to the
 * admin. The API token stays on the server: the browser only ever talks to
 * this route (with the admin session), never to Fakturownia.
 *
 * Fakturownia renders a PDF a moment after the document is created, and on a
 * KSeF account only once the KSeF number arrives; until then this answers
 * 409 with a readable message. In demo mode the PDF is generated (a page with
 * the kind, the number and a simulation note), without any request.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const row = await getDocument(svc, req.params.id)
  if (!row || Boolean(row.demo) !== svc.isDemo() || !row.fakturownia_id) {
    res.status(404).json({ message: "Document not found, or not in Fakturownia yet." })
    return
  }
  await sendDocumentPdf(req.scope, res, row)
}
