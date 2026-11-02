import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEFAULT_LOG_LINES, MAX_LOG_LINES } from "../../../../../../modules/railway/lib/constants"
import { loadRailwayLogs } from "../../../../../../workflows/railway/reads"
import { boolParam, intParam, needsSetup, query, respond, strParam, wantsFresh } from "../../../helpers"

/**
 * GET /admin/railway/deployments/:id/logs?kind=deploy|build&errors=1&q=&minutes=60&limit=300
 *
 * Runtime (deploy) or build logs of a deployment of this project, newest
 * first, every line masked (credentials in URLs, keys, bearer tokens, JWTs,
 * secret-named variables). The error filter and the search run over the
 * masked lines of the cached read.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (needsSetup(req, res)) return
  const q = query(req)
  await respond(req, res, () =>
    loadRailwayLogs(req.scope, String(req.params.id ?? ""), {
      kind: strParam(q.kind) === "build" ? "build" : "deploy",
      errorsOnly: boolParam(q.errors),
      q: strParam(q.q),
      minutes: intParam(q.minutes, 0, 0, 10_080),
      limit: intParam(q.limit, DEFAULT_LOG_LINES, 20, MAX_LOG_LINES),
      force: wantsFresh(req),
    }),
  )
}
