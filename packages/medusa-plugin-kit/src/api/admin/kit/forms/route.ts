import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { clientOf } from "../../../kit/helpers"
import type { KitApiError } from "../../../../modules/kit/lib/client"

/** GET /admin/kit/forms - the account's forms, for the double opt-in select. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const forms = await clientOf(req.scope).forms()
    return res.json({ forms: forms.map((f) => ({ id: f.id, name: f.name, type: f.type, status: f.status, is_double_opt_in: f.is_double_opt_in })) })
  } catch (e) {
    const err = e as KitApiError
    return res.status(err.kind === "auth" ? 401 : err.kind === "rate" ? 429 : 502).json({ error: err.kind, message: err.message })
  }
}
