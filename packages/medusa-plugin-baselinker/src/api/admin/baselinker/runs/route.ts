import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { RUN_KINDS, type RunsResponse } from "../../../../modules/baselinker/lib/contract"
import { toRunDto, type RunRow } from "../../../../modules/baselinker/lib/dto"
import { baselinkerService, intParam, strParam } from "../helpers"

/** GET /admin/baselinker/runs?kind=<run kind>&limit= : background runs of the current mode, newest first. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  const kind = strParam(req.query.kind)
  const limit = intParam(req.query.limit, 15, 1, 50)
  const where: Record<string, unknown> = { source: svc.isDemo() ? "demo" : "api" }
  if ((RUN_KINDS as readonly string[]).includes(kind)) where.kind = kind
  const rows = (await svc.listBaseLinkerSyncRuns(where as never, { take: limit, order: { started_at: "DESC" } } as never)) as unknown as RunRow[]
  const body: RunsResponse = { runs: rows.map(toRunDto) }
  res.json(body)
}
