import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { TasksResponse } from "../../../../modules/subiekt/lib/contract"
import { toTaskDto, type TaskRow } from "../../../../modules/subiekt/lib/dto"
import { intParam, strParam, subiektService } from "../helpers"

const GROUPS: Record<string, string[] | null> = {
  all: null,
  attention: ["failed"],
  open: ["waiting", "pending", "running", "unknown"],
  done: ["succeeded", "canceled"],
}

/**
 * GET /admin/subiekt/tasks?filter=attention|open|done|all&q=&limit=&offset=
 *
 * The queue towards the bridge, newest first. `q` matches the order number
 * (display id) or the order id.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const filter = strParam(req.query.filter) || "all"
  const q = strParam(req.query.q).replace(/^#/, "")
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 100_000)

  const where: Record<string, unknown> = { demo: svc.isDemo() }
  const statuses = GROUPS[filter] ?? null
  if (statuses) where.status = statuses
  if (q) {
    if (/^\d+$/.test(q)) where.display_id = Number(q)
    else where.order_id = q
  }

  const [rows, count] = await svc.listAndCountSubiektTasks(where as never, {
    take: limit,
    skip: offset,
    order: { created_at: "DESC" },
  } as never)
  const body: TasksResponse = { tasks: (rows as unknown as TaskRow[]).map(toTaskDto), count, offset, limit }
  res.json(body)
}
