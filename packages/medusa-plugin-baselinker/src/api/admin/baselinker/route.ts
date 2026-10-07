import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { baselinkerService, buildStatus, guarded } from "./helpers"

/**
 * GET /admin/baselinker
 *
 * Configuration summary (never the token), counters, the last run of each
 * kind and what runs right now. Reads the database only, never BaseLinker,
 * and never writes, in demo mode too: the demo snapshot is built by the
 * `baselinker-demo` job or `POST /admin/baselinker/demo/prepare`.
 */
export const GET = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  res.json(await buildStatus(baselinkerService(req.scope)))
})
