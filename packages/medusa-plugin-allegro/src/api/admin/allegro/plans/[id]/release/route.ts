import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroActionResponse } from "../../../../../../modules/allegro/lib/contract"
import { releasePlanItem } from "../../../../../../workflows/allegro/plans"
import { allegroService } from "../../../helpers"

/** POST /admin/allegro/plans/:id/release : a quarantined line is planned again on the next run. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const ok = await releasePlanItem(svc, req.params.id)
  const body: AllegroActionResponse = { ok, message: ok ? null : "No such plan line." }
  res.status(ok ? 200 : 404).json(body)
}
