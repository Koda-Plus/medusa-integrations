import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loadRailwayOverview } from "../../../../workflows/railway/reads"
import { needsSetup, respond, wantsFresh } from "../helpers"

/**
 * GET /admin/railway/overview?fresh=1
 *
 * Every service of the environment with its latest and active deployment,
 * commit, uptime, instances, domains, volumes, memory and errors of the last
 * hour, plus the problems. Cached for `cacheSeconds`; `fresh=1` reads again
 * once the last read is 15 seconds old.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (needsSetup(req, res)) return
  await respond(req, res, () => loadRailwayOverview(req.scope, { force: wantsFresh(req) }))
}
