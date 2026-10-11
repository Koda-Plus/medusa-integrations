import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { clientOf } from "../../../kit/helpers"
import type { KitApiError } from "../../../../modules/kit/lib/client"

/** GET /admin/kit/tags - the account's tags, for the settings select. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const tags = await clientOf(req.scope).tags()
    return res.json({ tags })
  } catch (e) {
    const err = e as KitApiError
    return res.status(err.kind === "auth" ? 401 : err.kind === "rate" ? 429 : 502).json({ error: err.kind, message: err.message })
  }
}
