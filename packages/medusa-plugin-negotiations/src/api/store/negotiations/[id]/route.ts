import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { storeDetail } from "../../../../workflows/negotiations/read"
import { storeRoute } from "../helpers"

/**
 * GET /store/negotiations/:id
 *
 * One of the customer's negotiations with its conversation (internal notes
 * of the team are never included) and what the customer may do now
 * (`can_reply`, `can_accept`, `can_decline`). Someone else's negotiation
 * answers 404, like one that does not exist.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await storeRoute(req, res, "read", (customerId) => storeDetail(req.scope, customerId, String(req.params.id ?? "")))
}
