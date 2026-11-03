import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { metricRange } from "../../../../../../modules/railway/lib/metrics"
import { loadRailwayMetrics } from "../../../../../../workflows/railway/reads"
import { needsSetup, query, respond, strParam, wantsFresh } from "../../../helpers"

/** GET /admin/railway/services/:id/metrics?range=1h|6h|24h: CPU, memory and network of a service. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (needsSetup(req, res)) return
  const range = metricRange(strParam(query(req).range))
  await respond(req, res, () => loadRailwayMetrics(req.scope, String(req.params.id ?? ""), range, { force: wantsFresh(req) }))
}
