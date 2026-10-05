import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroActionResponse } from "../../../../../../modules/allegro/lib/contract"
import { retryImport } from "../../../../../../workflows/allegro/run-import"

/** POST /admin/allegro/imports/:id/retry : a held or skipped form goes back to the queue, attempts reset. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ok = await retryImport(req.scope, req.params.id)
  const body: AllegroActionResponse = { ok, message: ok ? null : "Only held or skipped forms can be retried." }
  res.status(ok ? 200 : 409).json(body)
}
