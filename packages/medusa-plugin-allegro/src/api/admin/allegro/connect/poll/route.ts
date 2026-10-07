import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { pollConnecting } from "../../../../../modules/allegro/lib/connection"
import type { AllegroConnectPollResponse } from "../../../../../modules/allegro/lib/contract"
import { syncAllegroOffersWorkflow } from "../../../../../workflows/allegro/sync-allegro-offers"
import { syncAllegroOrdersWorkflow } from "../../../../../workflows/allegro/sync-allegro-orders"
import { allegroService, sendError } from "../../helpers"

/**
 * POST /admin/allegro/connect/poll
 *
 * One step of the device login. The admin calls it every few seconds while
 * the code is on screen; `intervalS` says when to call again (Allegro may ask
 * to slow down). When the seller approved, the first syncs start right away.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  try {
    const step = await pollConnecting(svc)
    if (step.state === "connected") {
      void syncAllegroOffersWorkflow(req.scope)
        .run({ input: { trigger: "auto" } })
        .then(() => (svc.getOptions().ordersEnabled ? syncAllegroOrdersWorkflow(req.scope).run({ input: { trigger: "auto" } }) : undefined))
        .catch((err: unknown) => svc.getLogger().error(`[allegro] first sync: ${svc.mask(String(err))}`))
    }
    const body: AllegroConnectPollResponse = { state: step.state, intervalS: step.intervalS }
    res.json(body)
  } catch (err) {
    sendError(res, svc, err, "connect poll")
  }
}
