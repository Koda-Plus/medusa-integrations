import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroRunsResponse } from "../../../../modules/allegro/lib/contract"
import { toRunDto, type RunRow } from "../../../../modules/allegro/lib/dto"
import { allegroService, intParam, strParam } from "../helpers"

/** GET /admin/allegro/runs?kind=offers|orders&limit= : the latest runs, newest first. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const kind = strParam(req.query.kind)
  const where = kind === "offers" || kind === "orders" ? { kind } : {}
  const rows = (await svc.listAllegroSyncRuns(where as never, {
    take: intParam(req.query.limit, 10, 1, 50),
    order: { started_at: "DESC" },
  })) as unknown as RunRow[]
  const body: AllegroRunsResponse = { runs: rows.map(toRunDto) }
  res.json(body)
}
