import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CorrectionsResponse, PlanFilter } from "../../../../modules/fakturownia/lib/contract"
import type { PlanRow } from "../../../../modules/fakturownia/lib/dto"
import { PLAN_FILTERS } from "../../../../workflows/fakturownia/corrections"
import { fakturowniaService, intParam, like, planDtos, strParam } from "../helpers"

const FILTERS: readonly PlanFilter[] = ["open", "approved", "issued", "closed", "all"]

/**
 * GET /admin/fakturownia/corrections?filter=open|approved|issued|closed|all&q=&limit=&offset=
 *
 * The correction plans of the current mode, newest first: what changed after
 * issue, the positions before and after, the totals, and what a person can
 * do. `q` matches the corrected document's number or the order number.
 * Reads the database only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const raw = strParam(req.query.filter) as PlanFilter
  const filter: PlanFilter = FILTERS.includes(raw) ? raw : "open"
  const q = strParam(req.query.q).slice(0, 80)
  const where: Record<string, unknown> = { demo: svc.isDemo() }
  if (filter !== "all") where.status = [...PLAN_FILTERS[filter]]
  if (q) {
    const bare = q.replace(/^#/, "")
    const or: Array<Record<string, unknown>> = [{ document_number: { $ilike: like(q) } }]
    if (/^\d+$/.test(bare) && Number(bare) < 2_147_483_647) or.push({ display_id: Number(bare) })
    if (/^order_[A-Za-z0-9]+$/.test(q)) or.push({ order_id: q })
    where.$or = or
  }
  const [rows, count] = (await svc.listAndCountFakturowniaCorrections(where as never, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  } as never)) as unknown as [PlanRow[], number]
  const body: CorrectionsResponse = { plans: await planDtos(req.scope, rows), count, limit, offset }
  res.json(body)
}
