import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DocumentsResponse } from "../../../../modules/subiekt/lib/contract"
import { toDocumentDto, type DocumentRow } from "../../../../modules/subiekt/lib/dto"
import { intParam, strParam, subiektService } from "../helpers"

/**
 * GET /admin/subiekt/documents?kind=ZK|WZ&q=&limit=&offset=
 *
 * Documents Subiekt issued for Medusa orders, newest first. Only the current
 * mode: demo documents never mix with real ones.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const kind = strParam(req.query.kind).toUpperCase()
  const q = strParam(req.query.q).replace(/^#/, "")
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 100_000)

  const where: Record<string, unknown> = { demo: svc.isDemo() }
  if (/^[A-Z]{1,6}$/.test(kind)) where.kind = kind
  if (q) {
    if (/^\d+$/.test(q)) where.display_id = Number(q)
    else where.number = { $ilike: `%${q.replace(/[%_]/g, "")}%` }
  }

  const [rows, count] = await svc.listAndCountSubiektDocuments(where as never, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  } as never)
  const body: DocumentsResponse = { documents: (rows as unknown as DocumentRow[]).map(toDocumentDto), count, offset, limit }
  res.json(body)
}
