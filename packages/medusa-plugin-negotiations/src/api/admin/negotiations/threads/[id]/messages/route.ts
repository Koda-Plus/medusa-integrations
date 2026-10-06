import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminMessage } from "../../../../../../workflows/negotiations/threads"
import { moveAnswer } from "../../../helpers"

/**
 * POST /admin/negotiations/threads/:id/messages
 *
 * `{ message }`: the team writes to the customer. The status stays; the
 * customer has the next move. 409 on a closed thread.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await moveAnswer(req, res, adminMessage)
}
