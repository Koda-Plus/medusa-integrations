import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { skipReturn } from "../../../../../../workflows/inpost/returns"
import { actorOf, respondReturn } from "../../../helpers"

/**
 * POST /admin/inpost/returns/:id/skip
 *
 * The return is handled outside the plugin (created in InPost by hand, or not
 * needed after all): the row leaves the open returns and nothing will ever
 * be sent for it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondReturn(req, res, () => skipReturn(req.scope, req.params.id, actorOf(req)))
}
