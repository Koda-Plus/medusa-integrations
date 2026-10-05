import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroImportWindowResponse } from "../../../../../modules/allegro/lib/contract"
import { queueImportWindow } from "../../../../../workflows/allegro/run-import"
import { allegroService, errorOf } from "../../helpers"

/**
 * POST /admin/allegro/imports/window  { from: ISO date, to: ISO date }
 *
 * The operator import window: checkout forms bought in the range and ready
 * for processing are queued once each, and imported by the next armed run.
 * For history before the import was armed, and for gaps longer than the 60
 * days Allegro keeps order events. The event cursor is not touched.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const body = (req.body ?? {}) as { from?: unknown; to?: unknown }
  const from = new Date(String(body.from ?? ""))
  const to = new Date(String(body.to ?? ""))
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    res.status(400).json({ message: "from and to must be dates." })
    return
  }
  try {
    const answer: AllegroImportWindowResponse = await queueImportWindow(req.scope, from, to)
    res.json(answer)
  } catch (err) {
    res.status(502).json({ message: errorOf(svc, err) })
  }
}
