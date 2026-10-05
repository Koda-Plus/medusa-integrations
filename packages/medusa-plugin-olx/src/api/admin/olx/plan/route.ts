import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OlxPlanResponse } from "../../../../modules/olx/lib/contract"
import { toPlanItemDto, type PlanItemRow } from "../../../../modules/olx/lib/dto"
import { intParam, olxService, strParam } from "../helpers"

const VIEWS: Record<string, string[] | null> = {
  open: ["pending", "held", "applying", "failed", "unknown", "quarantined"],
  quarantined: ["quarantined"],
  held: ["held"],
  done: ["done"],
  all: null,
}

/**
 * GET /admin/olx/plan?writer=lifecycle|price&view=open|held|quarantined|done|all&limit=&offset=
 *
 * The plan rows of the lifecycle or the price writer: what would change on
 * OLX, from what to what, and how the last attempt went.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const writer = strParam(req.query.writer) === "price" ? "price" : "lifecycle"
  const view = strParam(req.query.view) || "open"
  const states = VIEWS[view] === undefined ? VIEWS.open : VIEWS[view]
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const where: Record<string, unknown> = { writer, demo: svc.isDemo() }
  if (states) where.state = states
  const [rows, count] = (await svc.listAndCountOlxPlanItems(where as never, {
    take: limit,
    skip: offset,
    order: { planned_at: "DESC" },
  })) as unknown as [PlanItemRow[], number]
  const body: OlxPlanResponse = { items: rows.map(toPlanItemDto), count, limit, offset }
  res.json(body)
}
