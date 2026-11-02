import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setProgram } from "../../../../../workflows/vonhalsky/offers"
import { idsOf, respond } from "../../../../vonhalsky/admin-helpers"

/** POST /admin/vonhalsky/offers/program { ids, mode: "IN" | "OUT" }: joins or leaves the marketplace price program. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ids = idsOf(req.body, "vhoff")
  if (ids.length === 0) {
    res.status(400).json({ code: "no_ids", message: "Choose at least one offer." })
    return
  }
  await respond(res, () => setProgram(req.scope, ids, (req.body as { mode?: unknown } | undefined)?.mode))
}
