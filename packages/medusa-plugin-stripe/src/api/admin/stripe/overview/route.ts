import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loadStripeOverview } from "../../../../workflows/stripe/reads"
import { originOf, respond, wantsFresh } from "../helpers"

/**
 * GET /admin/stripe/overview?fresh=1
 *
 * The panel: volume, fees and net for 7 and 30 days by payment method, the
 * success rate, the newest payments, open disputes with their evidence
 * deadline, recent refunds, the balance and the payouts. Served from the
 * cache while it is younger than `cacheSeconds`; `fresh=1` reads Stripe
 * again (once the last read is 30 seconds old). Only GET requests reach
 * Stripe, and only from here and the other routes of this page.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respond(req, res, () => loadStripeOverview(req.scope, { force: wantsFresh(req), origin: originOf(req) }))
}
