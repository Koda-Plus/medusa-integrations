import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DocumentResponse } from "../../../../../../modules/fakturownia/lib/contract"
import { markIssued } from "../../../../../../workflows/fakturownia/documents"
import { getDocument } from "../../../../../../workflows/fakturownia/runtime"
import { ActionError, documentDto, fakturowniaService } from "../../../helpers"

/**
 * POST /admin/fakturownia/documents/:id/mark-issued  { "number": "FV 12/10/2026", "fakturowniaId": "123456789" }
 *
 * "Mark as issued": a person found (or issued by hand) the document in
 * Fakturownia. The number is required; with the Fakturownia id (the number in
 * the document's address) the document is read first and its number must
 * match. Only a failed document or one with an unknown result can be marked.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const row = await getDocument(svc, req.params.id)
  if (!row || Boolean(row.demo) !== svc.isDemo()) {
    res.status(404).json({ message: "Document not found." })
    return
  }
  const input = (req.body ?? {}) as { number?: unknown; fakturowniaId?: unknown }
  try {
    const moved = await markIssued(req.scope, row.id, {
      number: typeof input.number === "string" ? input.number : "",
      fakturowniaId: typeof input.fakturowniaId === "string" || typeof input.fakturowniaId === "number" ? String(input.fakturowniaId) : null,
    })
    const body: DocumentResponse = { document: documentDto(svc, moved), outcome: "marked" }
    res.json(body)
  } catch (err) {
    if (err instanceof ActionError) {
      res.status(err.status).json({ message: svc.mask(err.message) })
      return
    }
    throw err
  }
}
