import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { storeAnswer } from "../../../../../workflows/negotiations/read"
import { customerMessage } from "../../../../../workflows/negotiations/threads"
import { bodyOf, storeRoute } from "../../helpers"

/**
 * POST /store/negotiations/:id/messages
 *
 * `{ message, target_price? }`: the customer writes. With `target_price` it
 * is a new target, and a countered negotiation is open again. Emits
 * `negotiation.message_added`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await storeRoute(req, res, "write", async (customerId) => {
    const r = await customerMessage(req.scope, { customerId, id: String(req.params.id ?? ""), body: bodyOf(req) })
    return storeAnswer(req.scope, r.thread)
  })
}
