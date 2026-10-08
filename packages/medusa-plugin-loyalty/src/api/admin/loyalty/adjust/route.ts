import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adjust } from "../../../../workflows/loyalty/account"
import { bodyOf, fail } from "../../../loyalty/helpers"

/**
 * POST /admin/loyalty/adjust
 *
 * A manual adjustment of a customer's points: positive reads as a bonus,
 * negative as a correction. Body: { customer_id, delta, reason }.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = bodyOf(req)
  const customerId = typeof body.customer_id === "string" ? body.customer_id.trim() : ""
  const delta = typeof body.delta === "number" ? Math.trunc(body.delta) : Math.trunc(Number(body.delta))
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  if (!customerId) {
    fail(res, 400, "customer_required", "Pick a customer.")
    return
  }
  if (!Number.isFinite(delta) || delta === 0) {
    fail(res, 400, "delta_required", "The adjustment needs a non-zero number of points.")
    return
  }
  if (!reason) {
    fail(res, 400, "reason_required", "Say why the points change.")
    return
  }
  const balance = await adjust(req.scope, { customerId, delta, reason })
  res.status(201).json({ balance })
}
