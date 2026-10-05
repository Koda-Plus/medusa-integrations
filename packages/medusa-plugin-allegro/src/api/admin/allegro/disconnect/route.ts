import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { disconnect } from "../../../../modules/allegro/lib/connection"
import { allegroService, buildStatus } from "../helpers"

/**
 * POST /admin/allegro/disconnect
 *
 * Forgets the tokens and any device login in progress. The consent on the
 * Allegro side stays until the seller removes it in the account settings.
 * The snapshot stays too, so the admin still shows the last known state.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  if (svc.isDemo()) {
    res.status(409).json({ message: "Demo mode: there is no real account to disconnect." })
    return
  }
  await disconnect(svc)
  res.json(await buildStatus(svc))
}
