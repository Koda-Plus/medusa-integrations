import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildStatus } from "./helpers"

/**
 * GET /admin/railway
 *
 * The setup as the admin may see it: the mode, what is missing, the token's
 * kind once known (never the token), the options in use and the request
 * counters. No call to Railway.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json(buildStatus(req.scope))
}
