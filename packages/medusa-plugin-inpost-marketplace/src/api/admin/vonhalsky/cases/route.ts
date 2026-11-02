import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CaseFilter } from "../../../../modules/vonhalsky/lib/contract"
import { listCases } from "../../../../workflows/vonhalsky/cases"
import { intParam, searchParam } from "../../../vonhalsky/admin-helpers"

const FILTERS: CaseFilter[] = ["all", "open", "return", "claim", "refund"]

/**
 * GET /admin/vonhalsky/cases?filter=&q=&offset=&limit=: returns, claims and
 * refunds as the sync saved them, newest first. No buyer contact data are
 * kept; the detail route reads them live. Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const filter = FILTERS.includes(String(req.query.filter) as CaseFilter) ? String(req.query.filter) : "all"
  res.json(await listCases(req.scope, { filter, search: searchParam(req.query.q), offset: intParam(req.query.offset, 0, 0, 1_000_000), limit: intParam(req.query.limit, 50, 1, 200) }))
}
