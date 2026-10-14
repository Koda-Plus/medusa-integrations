import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { DetailResponse } from "../../../../modules/coupons/lib/contract"
import { setCouponStatus } from "../../../../workflows/coupons/create"
import { couponDetail } from "../../../../workflows/coupons/reads"
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

/** POST /admin/coupons/:id  { status: "active" | "inactive" }: pause it or turn it back on. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = idParam(req)
  const status = (req.body as { status?: unknown } | undefined)?.status
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
