import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroActionResponse } from "../../../../../../modules/allegro/lib/contract"
import { markImportHandled } from "../../../../../../workflows/allegro/run-import"

/**
 * POST /admin/allegro/imports/:id/handled
 *
 * A person checked an imported order that needed attention (a change or a
 * cancellation on Allegro after the import, a total that differs): the flag
 * goes, the reason stays, and the row records who and when. The order line
 * and the board counter go back to normal.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const actor = (req as MedusaRequest & { auth_context?: { actor_id?: string } }).auth_context?.actor_id ?? null
  const ok = await markImportHandled(req.scope, req.params.id, actor)
  const body: AllegroActionResponse = { ok, message: ok ? null : "Only an order that needs attention can be marked as handled." }
  res.status(ok ? 200 : 409).json(body)
}
