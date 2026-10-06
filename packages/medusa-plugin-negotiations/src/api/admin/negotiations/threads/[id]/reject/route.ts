import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminReject } from "../../../../../../workflows/negotiations/threads"
import { moveAnswer } from "../../../helpers"

/**
 * POST /admin/negotiations/threads/:id/reject
 *
 * `{ message? }`: the team rejects; the message tells the customer why.
 * Emits `negotiation.rejected`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await moveAnswer(req, res, adminReject)
}
