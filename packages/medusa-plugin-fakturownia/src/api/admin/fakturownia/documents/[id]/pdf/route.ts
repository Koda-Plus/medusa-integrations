import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { describeError, FakturowniaApiError } from "../../../../../../modules/fakturownia/lib/errors"
import { clientFor, getDocument } from "../../../../../../workflows/fakturownia/runtime"
import { fakturowniaService, pdfFileName } from "../../../helpers"

/**
 * GET /admin/fakturownia/documents/:id/pdf
 *
 * The PDF of an issued document, fetched server side and streamed to the
 * admin. The API token stays on the server: the browser only ever talks to
 * this route (with the admin session), never to Fakturownia.
 *
 * Fakturownia renders a PDF a moment after the document is created, and on a
 * KSeF account only once the KSeF number arrives; until then this answers
 * 409 with a readable message. Not available in demo mode.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  if (svc.isDemo()) {
    res.status(409).json({ message: "Demo mode has no PDF: the documents exist only in the simulated account." })
    return
  }
  const row = await getDocument(svc, req.params.id)
  if (!row || row.demo || !row.fakturownia_id) {
    res.status(404).json({ message: "Document not found, or not in Fakturownia yet." })
    return
  }
  try {
    const file = await clientFor(svc).downloadPdf(row.fakturownia_id)
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `inline; filename="${pdfFileName(row.number, `document-${row.fakturownia_id}`)}"`)
    res.setHeader("Cache-Control", "private, no-store")
    res.status(200).send(Buffer.from(file.bytes))
  } catch (err) {
    const notReady = err instanceof FakturowniaApiError && err.code === "PDF_NOT_READY"
    res.status(notReady ? 409 : 502).json({
      message: notReady
        ? "Fakturownia has not rendered this PDF yet (a new document, or a KSeF number still on its way). Try again in a minute."
        : svc.mask(describeError(err).message),
    })
  }
}
