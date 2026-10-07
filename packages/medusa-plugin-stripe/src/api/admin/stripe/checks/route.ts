import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runStripeChecks } from "../../../../workflows/stripe/reads"
import { originOf, respond, wantsFresh } from "../helpers"

/**
 * GET /admin/stripe/checks?fresh=1
 *
 * The health checks, each with a verdict (pass, warn, fail, info, off,
 * unknown), the facts behind it and how to fix it: the Stripe provider in
 * medusa-config, the key, the account, the payment methods, the webhook
 * endpoint and its failed deliveries, the Apple Pay and Google Pay domains,
 * the PLN regions, the capture mode and payments that never became an order.
 * Cached like the panel.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respond(req, res, () => runStripeChecks(req.scope, { force: wantsFresh(req), origin: originOf(req) }))
}
