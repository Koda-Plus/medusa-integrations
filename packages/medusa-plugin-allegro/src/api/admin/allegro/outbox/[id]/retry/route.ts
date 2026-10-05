import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroActionResponse } from "../../../../../../modules/allegro/lib/contract"
import { retryOutbox } from "../../../../../../workflows/allegro/run-shipping"

/** POST /admin/allegro/outbox/:id/retry : a failed parcel, status or invoice is sent again, after a lookup on Allegro. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ok = await retryOutbox(req.scope, req.params.id)
  const body: AllegroActionResponse = { ok, message: ok ? null : "Only failed or skipped items can be retried." }
  res.status(ok ? 200 : 409).json(body)
}
