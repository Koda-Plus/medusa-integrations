import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isConnected } from "../../../../modules/allegro/lib/connection"
import type { AllegroSyncResponse } from "../../../../modules/allegro/lib/contract"
import { isOffersSyncRunning } from "../../../../workflows/allegro/run-offers"
import { isOrdersSyncRunning } from "../../../../workflows/allegro/run-orders"
import { syncAllegroOffersWorkflow } from "../../../../workflows/allegro/sync-allegro-offers"
import { syncAllegroOrdersWorkflow } from "../../../../workflows/allegro/sync-allegro-orders"
import { allegroService } from "../helpers"

/**
 * POST /admin/allegro/sync  { what?: "offers" | "orders" | "all" }
 *
 * Manual sync: the SAME workflows as the scheduled jobs. Answers 202 right
 * away and runs in the background; the admin polls GET /admin/allegro while
 * `running`. "all" (the default) reads the offers first, then the orders, so
 * order lines link to the freshest offers.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const mode = svc.isDemo() ? "demo" : "live"
  const body = (req.body ?? {}) as { what?: unknown }
  const what = body.what === "offers" || body.what === "orders" ? body.what : "all"

  const busy = (what !== "orders" && isOffersSyncRunning()) || (what !== "offers" && isOrdersSyncRunning())
  if (busy) {
    const answer: AllegroSyncResponse = { started: false, alreadyRunning: true, mode }
    res.status(202).json(answer)
    return
  }
  if (mode === "live") {
    if (!svc.isConfigured()) {
      res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
      return
    }
    if (!(await isConnected(svc))) {
      res.status(409).json({ message: "Connect the Allegro account first." })
      return
    }
  }

  const fail = (err: unknown) =>
    svc.getLogger().error(`[allegro] manual sync: ${svc.mask(err instanceof Error ? err.message : String(err))}`)
  const offers = async (): Promise<void> => {
    await syncAllegroOffersWorkflow(req.scope).run({ input: { trigger: "manual" } })
  }
  const orders = async (): Promise<void> => {
    if (svc.getOptions().ordersEnabled) await syncAllegroOrdersWorkflow(req.scope).run({ input: { trigger: "manual" } })
  }
  if (what === "offers") void offers().catch(fail)
  else if (what === "orders") void orders().catch(fail)
  else void offers().then(orders).catch(fail)

  const answer: AllegroSyncResponse = { started: true, alreadyRunning: false, mode }
  res.status(202).json(answer)
}
