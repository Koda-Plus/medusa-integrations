import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DocumentResponse } from "../../../../../../modules/fakturownia/lib/contract"
import { retryDocument } from "../../../../../../workflows/fakturownia/documents"
import { getDocument } from "../../../../../../workflows/fakturownia/runtime"
import { documentDto, fakturowniaService } from "../../../helpers"

/**
 * POST /admin/fakturownia/documents/:id/retry
 *
 * "Retry" on a failed document: back to the queue with its attempts reset,
 * and a pass starts. Safe to click twice: only a `failed` row moves, and the
 * attempt looks the document up in Fakturownia before it creates anything.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const row = await getDocument(svc, req.params.id)
  if (!row || Boolean(row.demo) !== svc.isDemo()) {
    res.status(404).json({ message: "Document not found." })
    return
  }
  const moved = await retryDocument(req.scope, row.id)
  if (!moved) {
    res.status(409).json({ message: `Only a failed document can be retried; this one is ${row.status}.` })
    return
  }
  const body: DocumentResponse = { document: documentDto(svc, moved), outcome: "queued" }
  res.status(202).json(body)
}
