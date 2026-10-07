import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { contentDisposition } from "../../../../../../modules/fakturownia/lib/pdf"
import { ksefFile } from "../../../../../../workflows/fakturownia/ksef"
import { getDocument } from "../../../../../../workflows/fakturownia/runtime"
import { ActionError, fakturowniaService, strParam } from "../../../helpers"

/**
 * GET /admin/fakturownia/documents/:id/ksef-file?file=upo|xml
 *
 * The UPO (the official receipt of KSeF) or the KSeF XML of an accepted
 * document, fetched by the backend (`GET /invoices/{id}/attachment?kind=
 * gov_upo|gov`) and streamed as a download; the token never reaches the
 * browser. 409 before KSeF accepted the document, 404 while Fakturownia has
 * no file yet (up to an hour after a batch sending). Demo mode: a simulated
 * XML that says so.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const file = strParam(req.query.file) === "xml" ? "xml" : "upo"
  const row = await getDocument(svc, req.params.id)
  if (!row || Boolean(row.demo) !== svc.isDemo()) {
    res.status(404).json({ message: "Document not found." })
    return
  }
  try {
    const f = await ksefFile(req.scope, row, file)
    res.setHeader("Content-Type", f.contentType)
    res.setHeader("Content-Disposition", contentDisposition("attachment", f.filename, f.unicodeName))
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Cache-Control", "private, no-store")
    res.status(200).send(f.data)
  } catch (err) {
    if (err instanceof ActionError) {
      res.status(err.status).json({ message: svc.mask(err.message) })
      return
    }
    throw err
  }
}
