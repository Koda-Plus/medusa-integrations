import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { kitManifest } from "../../../../modules/kit/lib/integration"
import { optionsOf, settingsOf } from "../../../kit/helpers"

/** GET /admin/kit/integration - the koda.integration/1 manifest of the plugin. */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  return res.json(kitManifest(optionsOf(req.scope), await settingsOf(req.scope)))
}
