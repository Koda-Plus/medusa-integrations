import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { STORE_PDF_PER_MINUTE } from "../../../../../../modules/fakturownia/lib/constants"
import { sharedLimiter } from "../../../../../../modules/fakturownia/lib/rate-limit"
import { customerDocument, customerIdOf } from "../../../../../../workflows/fakturownia/storefront"
import { sendDocumentPdf } from "../../../../../admin/fakturownia/helpers"

/**
 * GET /store/fakturownia/documents/:id/pdf  (?download=1 for a download)
 *
 * The PDF of a document of the LOGGED-IN customer, fetched by the backend
 * from Fakturownia (generated in demo mode) and streamed; the API token never
 * reaches the storefront. Ownership through the order's customer id. 401
 * without a customer, 404 for someone else's document, 409 while Fakturownia
 * has not rendered the PDF yet, 429 after 10 PDFs a minute.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = customerIdOf(req as never)
  if (!customerId) {
    res.status(401).json({ message: "Log in to download your documents." })
    return
  }
  const limit = sharedLimiter("store-pdf", STORE_PDF_PER_MINUTE).hit(customerId)
  if (!limit.ok) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds))
    res.status(429).json({ message: "Too many downloads. Try again in a moment." })
    return
  }
  const row = await customerDocument(req.scope, req.params.id, customerId)
  if (!row) {
    res.status(404).json({ message: "Document not found." })
    return
  }
  await sendDocumentPdf(req.scope, res, row, String(req.query.download ?? "") === "1" ? "attachment" : "inline", "store")
}
