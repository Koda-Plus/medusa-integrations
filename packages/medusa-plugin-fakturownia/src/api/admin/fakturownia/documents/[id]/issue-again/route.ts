import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DocumentResponse } from "../../../../../../modules/fakturownia/lib/contract"
import { issueAgain } from "../../../../../../workflows/fakturownia/documents"
import { getDocument } from "../../../../../../workflows/fakturownia/runtime"
import { documentDto, fakturowniaService } from "../../../helpers"

/**
 * POST /admin/fakturownia/documents/:id/issue-again
 *
 * "Issue again" on a document whose create request got no answer, after a
 * person checked Fakturownia and did not find it. The attempt still looks
 * the document up first, and `oid_unique` makes Fakturownia refuse a second
 * document with the same order number.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const row = await getDocument(svc, req.params.id)
  if (!row || Boolean(row.demo) !== svc.isDemo()) {
    res.status(404).json({ message: "Document not found." })
    return
  }
  const moved = await issueAgain(req.scope, row.id)
  if (!moved) {
    res.status(409).json({ message: `Only a document with an unknown result can be issued again; this one is ${row.status}.` })
    return
  }
  const body: DocumentResponse = { document: documentDto(svc, moved), outcome: "queued" }
  res.status(202).json(body)
}
