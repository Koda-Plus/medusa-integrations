import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminCounter } from "../../../../../../workflows/negotiations/threads"
import { moveAnswer } from "../../../helpers"

/**
 * POST /admin/negotiations/threads/:id/counter
 *
 * `{ price, message?, valid_days? }`: the team offers a price, per unit (for
 * a cart thread: for the whole cart), as decimal text in the thread's
 * currency ("469.00" or "469,00"). With `valid_days` the offer expires that
 * many days from now. Emits `negotiation.countered`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await moveAnswer(req, res, adminCounter)
}
