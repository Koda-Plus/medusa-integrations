import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { allegroService, buildStatus, ensureDemoSnapshot } from "./helpers"

/**
 * GET /admin/allegro
 *
 * Connection, writers, counters, plans, imports, issues and the last runs
 * for the Allegro page in the admin. Reads the database only, never Allegro.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  await ensureDemoSnapshot(req.scope, svc)
  res.json(await buildStatus(req.scope))
}
