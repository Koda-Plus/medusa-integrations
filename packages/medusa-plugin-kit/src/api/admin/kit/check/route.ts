import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { clientOf, optionsOf } from "../../../kit/helpers"
import { isActive } from "../../../../modules/kit/lib/options"
import type { KitApiError } from "../../../../modules/kit/lib/client"

/**
 * GET /admin/kit/check - a live connection check: the account behind the
 * key, its tags and its forms. What the setup guide uses to say which step
 * is done. Read only; the key never leaves the server.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const o = optionsOf(req.scope)
  if (!isActive(o)) {
    return res.status(400).json({ error: "unconfigured", message: "No Kit API key: set the apiKey option." })
  }
  const client = clientOf(req.scope)
  try {
    const [account, tags, forms] = await Promise.all([client.account(), client.tags(), client.forms()])
    return res.json({
      ok: true,
      account,
      tags,
      forms: forms.map((f) => ({ id: f.id, name: f.name, type: f.type, status: f.status, is_double_opt_in: f.is_double_opt_in })),
    })
  } catch (e) {
    const err = e as KitApiError
    return res.status(err.kind === "auth" ? 401 : err.kind === "rate" ? 429 : 502).json({ error: err.kind, message: err.message })
  }
}
