import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createOrderFromInpost, orderDetails } from "../../../../../workflows/inpostpay/orders"
import { bodyOf, failWith, merchantGate } from "../../../helpers"

/**
 * POST /inpostpay/v1/izi/order (called by InPost Pay, signed): the customer
 * ordered in the app. The buyer, the addresses and the delivery go on the
 * cart, the mapped shipping option is added (the parcel locker in its data),
 * a payment session of this plugin's provider is created and the cart is
 * completed. Idempotent per basket: a repeated call answers with the same
 * order. The basket price InPost charged must match the cart.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!(await merchantGate(req, res))) return
  try {
    const { row, result } = await createOrderFromInpost(req.scope, bodyOf(req))
    res.status(result.already ? 200 : 201).json(await orderDetails(req.scope, row))
  } catch (e) {
    failWith(req, res, e)
  }
}
