import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminNote } from "../../../../../../workflows/negotiations/threads"
import { moveAnswer } from "../../../helpers"

/**
 * POST /admin/negotiations/threads/:id/notes
 *
 * `{ note }`: an internal note of the team, on any thread, open or closed.
 * Never shown to the customer, no event, does not restart the expiry clock.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await moveAnswer(req, res, adminNote)
}
