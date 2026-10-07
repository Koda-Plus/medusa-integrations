import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { loadOrderPayments } from "../../../../../workflows/stripe/order"
import { originOf, respond, wantsFresh } from "../../helpers"

/**
 * GET /admin/stripe/orders/:id
 *
 * The Stripe payments behind one order, for the order page widget: status,
 * method (BLIK, the Przelewy24 bank, the card and its wallet), amount, fee
 * and net, Radar's risk level, refunds and disputes with their deadline,
 * and the Dashboard link. The PaymentIntent id comes from the order's
 * payment (or payment session) data, as the official provider stores it.
 * `fresh=1` reads Stripe again once the last read is 30 seconds old.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const orderId = String(req.params.id ?? "")
  if (!/^[A-Za-z0-9_]{3,100}$/.test(orderId)) {
    res.status(400).json({ type: "invalid_data", message: "Not an order id." })
    return
  }
  await respond(req, res, () => loadOrderPayments(req.scope, orderId, { origin: originOf(req), force: wantsFresh(req) }))
}
