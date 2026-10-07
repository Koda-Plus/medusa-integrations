import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildStatus } from "./helpers"

/**
 * GET /admin/allegro
 *
 * Connection, writers, counters, plans, imports, issues and the last runs
 * for the Allegro page in the admin. READS ONLY: never Allegro, never a
 * workflow. In demo mode the sample data comes from the job
 * `allegro-demo-seed` or `POST /admin/allegro/demo/seed`; `demoSeed` says
 * what is still missing.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json(await buildStatus(req.scope))
}
