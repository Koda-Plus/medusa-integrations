import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { RunsResponse } from "../../../../modules/subiekt/lib/contract"
import { toRunDto, type RunRow } from "../../../../modules/subiekt/lib/dto"
import { intParam, strParam, subiektService } from "../helpers"

/** GET /admin/subiekt/runs?kind=stock|events|tasks|health&limit= : background runs, newest first. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const kind = strParam(req.query.kind)
  const limit = intParam(req.query.limit, 20, 1, 100)
  const where = ["stock", "events", "tasks", "health"].includes(kind) ? { kind, demo: svc.isDemo() } : { demo: svc.isDemo() }
  const rows = (await svc.listSubiektSyncRuns(where as never, { take: limit, order: { started_at: "DESC" } } as never)) as unknown as RunRow[]
  const body: RunsResponse = { runs: rows.map(toRunDto) }
  res.json(body)
}
