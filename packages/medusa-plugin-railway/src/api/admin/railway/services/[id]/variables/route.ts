import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loadRailwayVariables } from "../../../../../../workflows/railway/reads"
import { needsSetup, respond, wantsFresh } from "../../../helpers"

/**
 * GET /admin/railway/services/:id/variables
 *
 * Variable NAMES of a service with "set", "empty" or "reference" (a
 * `${{Service.NAME}}` reference). Railway is asked for the unrendered
 * values; they are reduced to that one word on the server and never cached
 * or sent.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (needsSetup(req, res)) return
  await respond(req, res, () => loadRailwayVariables(req.scope, String(req.params.id ?? ""), { force: wantsFresh(req) }))
}
