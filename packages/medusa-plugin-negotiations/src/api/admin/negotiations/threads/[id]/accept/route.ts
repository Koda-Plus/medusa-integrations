import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminAccept } from "../../../../../../workflows/negotiations/threads"
import { moveAnswer } from "../../../helpers"

/**
 * POST /admin/negotiations/threads/:id/accept
 *
 * `{ price?, message? }`: the team accepts the price on the table (the
 * customer's target, or the team's own offer). `price` is the price the
 * person saw: when it changed meanwhile, the answer is 409 `price_changed`
 * and nothing is accepted. Emits `negotiation.accepted`; an armed draft
 * order writer queues the thread.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await moveAnswer(req, res, adminAccept)
}
