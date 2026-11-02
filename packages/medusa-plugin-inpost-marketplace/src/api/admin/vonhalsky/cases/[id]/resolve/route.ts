import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resolveClaim } from "../../../../../../workflows/vonhalsky/cases"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/** POST /admin/vonhalsky/cases/:id/resolve { how, description }: answers a claim (how the seller resolves it). */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhcase_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not a case id of this plugin." })
    return
  }
  const body = (req.body ?? {}) as { how?: unknown; description?: unknown }
  await respond(res, () => resolveClaim(req.scope, id, body.how, body.description))
}
