import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CouponPatch, DetailResponse, UpdateResponse } from "../../../../modules/coupons/lib/contract"
import { setCouponStatus } from "../../../../workflows/coupons/create"
import { couponDetail } from "../../../../workflows/coupons/reads"
import { updateCoupon } from "../../../../workflows/coupons/update"
import { fail, idParam } from "../helpers"

/** GET /admin/coupons/:id: the coupon, its names and its latest orders. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  if (!id) {
    res.status(404).json({ message: "No such coupon." })
    return
  }
  try {
    const detail = await couponDetail(req.scope, id)
    if (!detail) {
      res.status(404).json({ message: "No such coupon." })
      return
    }
    const body: DetailResponse = detail
    res.json(body)
  } catch (err) {
    fail(req, res, err, "The coupon could not be read.")
  }
}

/**
 * POST /admin/coupons/:id
 *   { status: "active" | "inactive" }  pause it or turn it back on,
 *   { patch: CouponPatch }             the edit form: 400 with the keys of
 *                                      what is wrong, 409 when the code is taken.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  const body = (req.body ?? {}) as { status?: unknown; patch?: unknown }
  if (id && body.patch && typeof body.patch === "object") {
    try {
      const out: UpdateResponse = await updateCoupon(req.scope, id, body.patch as CouponPatch)
      res.json(out)
    } catch (err) {
      fail(req, res, err, "The coupon could not be changed. Nothing was saved.")
    }
    return
  }
  const status = body.status
  if (!id || (status !== "active" && status !== "inactive")) {
    res.status(400).json({ message: 'Send { "status": "active" } or { "status": "inactive" }.' })
    return
  }
  try {
    res.json({ coupon: await setCouponStatus(req.scope, id, status) })
  } catch (err) {
    fail(req, res, err, "The coupon could not be changed.")
  }
}
