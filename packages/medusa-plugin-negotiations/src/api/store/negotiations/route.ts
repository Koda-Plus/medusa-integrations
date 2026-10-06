import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { storeAnswer, storeList } from "../../../workflows/negotiations/read"
import { openNegotiation } from "../../../workflows/negotiations/threads"
import { bodyOf, salesChannelsOf, storeRoute } from "./helpers"

/**
 * GET /store/negotiations
 *
 * The logged-in customer's negotiations, latest activity first, without the
 * conversation. Query: `status` (one or more, comma separated),
 * `product_id`, `variant_id`, `cart_id` (is there a negotiation about
 * this?), `limit` (up to 50), `offset`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await storeRoute(req, res, "read", (customerId) => storeList(req.scope, customerId, (req.query ?? {}) as Record<string, unknown>))
}

/**
 * POST /store/negotiations
 *
 * Opens a negotiation for the logged-in customer:
 *
 *   { product_id?, variant_id?, cart_id?, quantity?, target_price?, currency_code?, message }
 *
 * About a product, a variant or the customer's own cart. `target_price` is
 * per unit (for a cart: for the whole cart), decimal text in major units
 * ("45.50" or "45,50"); left out, the customer asks for an offer. 201 with
 * the negotiation and its first message; 409 `already_open` (with
 * `negotiation_id`) when one about the same thing is still open. Emits
 * `negotiation.opened`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await storeRoute(
    req,
    res,
    "open",
    async (customerId) => {
      const r = await openNegotiation(req.scope, { customerId, body: bodyOf(req), salesChannelIds: salesChannelsOf(req) })
      return storeAnswer(req.scope, r.thread)
    },
    201,
  )
}
