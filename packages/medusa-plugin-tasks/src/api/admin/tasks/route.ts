import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildStatus } from "../../../workflows/tasks/read"
import { onBoard, queryOf } from "./helpers"

/**
 * GET /admin/tasks
 *
 * The status of the Tasks page for the person (or key) asking: their board
 * (`main`, or `sandbox` for sandbox accounts, seeded on the first visit),
 * the counters, who tasks can be assigned to, the options in use, the
 * sandbox and the adoption of the KODA Panel module's rows (team only), and
 * the stores running the plugin. `today=YYYY-MM-DD` counts overdue tasks by
 * the admin's own calendar day.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => buildStatus(req.scope, ctx, queryOf(req)))
}
