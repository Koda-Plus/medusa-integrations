import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { baselinkerService, buildStatus, ensureDemoSnapshot } from "./helpers"

/**
 * GET /admin/baselinker
 *
 * Configuration summary (never the token), counters, the last run of each
 * kind and what runs right now. Reads the database only, never BaseLinker.
 * In demo mode the first visit builds the simulated snapshot.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  await ensureDemoSnapshot(req.scope)
  res.json(await buildStatus(svc))
}
