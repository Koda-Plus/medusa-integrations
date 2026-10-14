import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ProductCouponsResponse } from "../../../../../../modules/coupons/lib/contract"
import { productCoupons } from "../../../../../../workflows/coupons/reads"
import { fail, idParam } from "../../../helpers"

/** GET /admin/coupons/for/product/:id: the data of the coupons card on the product page. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  if (!id) {
    res.status(404).json({ message: "Not found." })
    return
  }
  try {
    const body: ProductCouponsResponse = await productCoupons(req.scope, id)
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The coupons of this product could not be read.")
  }
}
