import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CustomerCouponsResponse } from "../../../../../../modules/coupons/lib/contract"
import { customerCoupons } from "../../../../../../workflows/coupons/reads"
import { fail, idParam } from "../../../helpers"

/** GET /admin/coupons/for/customer/:id: the data of the coupons card on the customer page. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  if (!id) {
    res.status(404).json({ message: "Not found." })
    return
  }
  try {
    const body: CustomerCouponsResponse = await customerCoupons(req.scope, id)
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The coupons of this customer could not be read.")
  }
}
