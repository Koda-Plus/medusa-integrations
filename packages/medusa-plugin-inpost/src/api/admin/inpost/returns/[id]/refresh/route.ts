import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refreshReturn } from "../../../../../../workflows/inpost/returns"
import { respondReturn } from "../../../helpers"

/**
 * POST /admin/inpost/returns/:id/refresh
 *
 * Reads the return from InPost again (GET .../shipments/:uuid): the drop-off
 * code, the tracking and short numbers, whether a label exists, the expiry.
 * The Returns API has no status; tracking is another InPost API.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondReturn(req, res, () => refreshReturn(req.scope, req.params.id))
}
