import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { retryReturn } from "../../../../../../workflows/inpost/returns"
import { actorOf, bodyOf, respondReturn } from "../../../helpers"

/**
 * POST /admin/inpost/returns/:id/retry  { "checked": true }
 *
 * A refused return (`failed`), or one without a clear answer (`unknown`),
 * goes back to pending, so a person may create it again from a new plan. For
 * `unknown` the body must say `checked: true`: the person looked in InPost
 * and the return is not there (the Returns API cannot look it up).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondReturn(req, res, () => retryReturn(req.scope, req.params.id, actorOf(req), bodyOf(req).checked === true))
}
