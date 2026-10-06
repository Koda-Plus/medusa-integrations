import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { storeAnswer } from "../../../../../workflows/negotiations/read"
import { customerDecline } from "../../../../../workflows/negotiations/threads"
import { bodyOf, storeRoute } from "../../helpers"

/**
 * POST /store/negotiations/:id/decline
 *
 * `{ message? }`: the customer declines and closes the negotiation (status
 * `rejected`, closed by the customer). Emits `negotiation.rejected`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await storeRoute(req, res, "write", async (customerId) => {
    const r = await customerDecline(req.scope, { customerId, id: String(req.params.id ?? ""), body: bodyOf(req) })
    return storeAnswer(req.scope, r.thread)
  })
}
