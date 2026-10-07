import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildStatus, originOf } from "./helpers"

/**
 * GET /admin/stripe
 *
 * The setup as the admin may see it: the mode, what is missing, the key's
 * kind, mode and last four characters (never the key), the options in use,
 * the webhook URL this backend expects and the references. No call to Stripe.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json(buildStatus(req.scope, originOf(req)))
}
