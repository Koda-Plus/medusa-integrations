import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { LookupsResponse } from "../../../../modules/coupons/lib/contract"
import { lookups } from "../../../../workflows/coupons/reads"
import { couponsService } from "../../../../workflows/coupons/runtime"
import { fail } from "../helpers"

/** GET /admin/coupons/lookups: customer groups, categories and currencies for the creator. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const o = couponsService(req.scope).getOptions()
    const body: LookupsResponse = await lookups(req.scope, o.memberGroupIds, o.currencyCode)
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The lists for the creator could not be read.")
  }
}
