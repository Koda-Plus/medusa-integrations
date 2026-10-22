import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { PoolProductsResponse } from "../../../../../modules/coupons/lib/contract"
import { poolProducts } from "../../../../../workflows/coupons/terms"
import { fail } from "../../helpers"

/** GET /admin/coupons/lookups/pool-products?pool=<id>: the products of one of the store's pools, one row per variant. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const pool = String((req.query as Record<string, unknown> | undefined)?.pool ?? "")
    if (!/^[A-Za-z0-9_:-]{1,80}$/.test(pool)) {
      res.status(400).json({ code: "coupon_invalid", message: "Name the pool: ?pool=<id>.", errors: ["pools"] })
      return
    }
    const body: PoolProductsResponse = await poolProducts(req.scope, pool)
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The products of the group could not be read.")
  }
}
