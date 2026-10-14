import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderCouponsResponse } from "../../../../../../modules/coupons/lib/contract"
import { orderCoupons } from "../../../../../../workflows/coupons/reads"
import { fail, idParam } from "../../../helpers"

/** GET /admin/coupons/for/order/:id: the data of the coupons card on the order page. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  if (!id) {
    res.status(404).json({ message: "Not found." })
    return
  }
  try {
    const body: OrderCouponsResponse = await orderCoupons(req.scope, id)
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The coupons of this order could not be read.")
  }
}
