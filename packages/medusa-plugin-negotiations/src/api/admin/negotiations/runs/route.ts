import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toRunDto } from "../../../../modules/negotiations/lib/dto"
import { intParam } from "../../../../modules/negotiations/lib/validation"
import { envOf } from "../../../../workflows/negotiations/runtime"

/**
 * GET /admin/negotiations/runs
 *
 * The history of background runs in the current mode, newest first:
 * expiry passes, draft order writer runs, rebuilds of the demo story.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const env = await envOf(req.scope)
  const limit = intParam((req.query ?? {}).limit, 30, 1, 100)
  const rows = await env.stores.settings.runs(env.options.demo, limit)
  res.json({ runs: rows.map(toRunDto) })
}
