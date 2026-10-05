import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DocumentResponse } from "../../../../../../modules/fakturownia/lib/contract"
import { checkDocument } from "../../../../../../workflows/fakturownia/documents"
import { getDocument } from "../../../../../../workflows/fakturownia/runtime"
import { documentDto, fakturowniaService } from "../../../helpers"

/**
 * POST /admin/fakturownia/documents/:id/check
 *
 * "Check in Fakturownia" on a document with an unknown result: the lookup by
 * order number runs now (read only). Found and matching: adopted as issued.
 * Found with another amount: failed as a conflict, for a person. Not found:
 * queued again once the grace period after the lost request is over.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const row = await getDocument(svc, req.params.id)
  if (!row || Boolean(row.demo) !== svc.isDemo()) {
    res.status(404).json({ message: "Document not found." })
    return
  }
  if (row.status !== "unknown") {
    res.status(409).json({ message: `Only a document with an unknown result is checked; this one is ${row.status}.` })
    return
  }
  const result = await checkDocument(req.scope, row.id)
  const body: DocumentResponse = { document: documentDto(svc, result.row ?? row), outcome: result.outcome }
  res.json(body)
}
