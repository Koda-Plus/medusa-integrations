import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { draftPlan } from "../../../../../workflows/negotiations/draft-orders"

/**
 * GET /admin/negotiations/writers/plan
 *
 * The plan of the draft order writer: every queued thread with the exact
 * input of `createOrderWorkflow`, or why it cannot become a draft. Reads
 * only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json(await draftPlan(req.scope))
}
