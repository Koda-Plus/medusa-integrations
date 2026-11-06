import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { checkReturnsConnection } from "../../../../../workflows/inpost/returns"
import { sendError } from "../../helpers"

/**
 * POST /admin/inpost/check/returns
 *
 * "Test connection" of the InPost Returns API: asks for a token with the
 * client credentials and the returns scopes, nothing else (no return is read
 * or created). Answers whether InPost gave one and for how long. Demo mode
 * answers without a request.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    res.setHeader("Cache-Control", "private, no-store")
    res.json({ result: await checkReturnsConnection(req.scope) })
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
