import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { EventRow } from "../../../../modules/inpost/lib/dto"
import { eventDtos, inpostService, intParam, sendError, strParam } from "../helpers"

/**
 * GET /admin/inpost/events?kind=run|webhook|action|status&limit=30&offset=0
 *
 * The history of the current mode, newest first: status passes, webhook
 * deliveries, actions, statuses.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const kind = strParam(req.query.kind)
    const limit = intParam(req.query.limit, 30, 1, 100)
    const offset = intParam(req.query.offset, 0, 0, 100_000)
    const filters: Record<string, unknown> = { demo: svc.isDemo() }
    if (["run", "webhook", "action", "status"].includes(kind)) filters.kind = kind
    const [rows, count] = (await svc.listAndCountInpostParcelEvents(filters as never, { take: limit, skip: offset, order: { occurred_at: "DESC" } } as never)) as unknown as [EventRow[], number]
    res.json({ events: await eventDtos(req.scope, rows), count, limit, offset })
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
