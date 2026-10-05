import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildStatus, ensureDemoSnapshot, subiektService } from "./helpers"

/**
 * GET /admin/subiekt
 *
 * Connection, queue counters and the last run of each kind for the Subiekt
 * page in the admin. Reads the database only, never the bridge.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  await ensureDemoSnapshot(req.scope)
  res.json(await buildStatus(svc))
}
