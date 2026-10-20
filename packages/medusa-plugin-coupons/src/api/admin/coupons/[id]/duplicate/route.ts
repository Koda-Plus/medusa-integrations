import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CreateResponse, DuplicateInput } from "../../../../../modules/coupons/lib/contract"
import { duplicateCoupon } from "../../../../../workflows/coupons/duplicate"
import { fail, idParam } from "../../helpers"

/**
 * POST /admin/coupons/:id/duplicate  { code, patch? }
 *
 * A copy of the coupon under a new code, with the form's changes on top.
 * 400 with the keys of what is wrong, 409 when the code is taken.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  if (!id) {
    res.status(404).json({ message: "No such coupon." })
    return
  }
  try {
    const out: CreateResponse = await duplicateCoupon(req.scope, id, (req.body ?? {}) as DuplicateInput)
    res.status(201).json(out)
  } catch (err) {
    fail(req, res, err, "The copy could not be made. Nothing was created.")
  }
}
