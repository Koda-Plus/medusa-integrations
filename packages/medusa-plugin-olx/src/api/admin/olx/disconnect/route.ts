import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { disconnect } from "../../../../modules/olx/lib/connection"
import { buildStatus, olxService } from "../helpers"

/**
 * POST /admin/olx/disconnect
 *
 * Forgets the tokens on our side. The consent on OLX stays until the seller
 * revokes it in the OLX account settings. The advert snapshot stays too: the
 * next sync after reconnecting verifies it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = olxService(req.scope)
  if (svc.isDemo()) {
    res.status(409).json({ message: "Demo mode: there is no OLX account to disconnect." })
    return
  }
  await disconnect(svc)
  res.json(await buildStatus(svc))
}
