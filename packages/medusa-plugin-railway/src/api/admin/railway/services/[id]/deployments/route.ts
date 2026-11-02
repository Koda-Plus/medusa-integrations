import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loadRailwayDeployments } from "../../../../../../workflows/railway/reads"
import { needsSetup, respond, wantsFresh } from "../../../helpers"

/** GET /admin/railway/services/:id/deployments: the last 20 deployments of a service of this environment. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (needsSetup(req, res)) return
  await respond(req, res, () => loadRailwayDeployments(req.scope, String(req.params.id ?? ""), { force: wantsFresh(req) }))
}
