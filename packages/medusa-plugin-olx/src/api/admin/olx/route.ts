import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildStatus, ensureDemoSnapshot, olxService } from "./helpers"

/**
 * GET /admin/olx
 *
 * Connection, counters and the last run for the OLX page in the admin.
 * Reads the database only, never OLX.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  await ensureDemoSnapshot(req.scope, svc)
  res.json(await buildStatus(svc))
}
