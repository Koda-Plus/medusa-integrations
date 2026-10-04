import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OlxRunsResponse } from "../../../../modules/olx/lib/contract"
import { toRunDto, type RunRow } from "../../../../modules/olx/lib/dto"
import { intParam, olxService } from "../helpers"

/** GET /admin/olx/runs?limit= : the latest sync runs, newest first. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  const limit = intParam(req.query.limit, 10, 1, 50)
  const rows = (await svc.listOlxSyncRuns({}, { take: limit, order: { started_at: "DESC" } })) as unknown as RunRow[]
  const body: OlxRunsResponse = { runs: rows.map(toRunDto) }
  res.json(body)
}
