import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { storeAnswer } from "../../../../../workflows/negotiations/read"
import { customerAccept } from "../../../../../workflows/negotiations/threads"
import { bodyOf, storeRoute } from "../../helpers"

/**
 * POST /store/negotiations/:id/accept
 *
 * `{ price?, message? }`: the customer accepts the store's counter offer.
 * Send `price` as shown to the customer (`offered_price`): when the offer
 * changed meanwhile, the answer is 409 `offer_changed` with the new
 * `offered_price` and nothing is accepted. Emits `negotiation.accepted`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await storeRoute(req, res, "write", async (customerId) => {
    const r = await customerAccept(req.scope, { customerId, id: String(req.params.id ?? ""), body: bodyOf(req) })
    return storeAnswer(req.scope, r.thread)
  })
}
