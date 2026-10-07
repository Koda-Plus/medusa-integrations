import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildStatus, sendError } from "./helpers"

/**
 * GET /admin/inpost
 *
 * The InPost page: mode, configuration, counters of the Panel lists,
 * writers, settings in force, the webhook, the last status pass. Reads the
 * database only; demo mode builds its sample shipments on the first visit.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    res.json(await buildStatus(req))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
