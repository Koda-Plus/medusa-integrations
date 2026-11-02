import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildStatus, sendError } from "./helpers"

/**
 * GET /admin/dpd  ->  StatusResponse
 *
 * The DPD page: mode, configuration, the options as the admin may see them
 * (never a secret), the sender checks, the writers, the settings in force
 * and the counts of the Panel lists. Reads the database only: no DPD call,
 * no write, no demo seeding.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    res.json(await buildStatus(req.scope))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
