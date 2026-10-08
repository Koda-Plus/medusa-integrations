import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toLimit } from "../../../../modules/credit/lib/store"
import { setLimit } from "../../../../workflows/credit/limits"
import { bodyOf, fail, money } from "../../../credit/helpers"

/**
 * POST /admin/credit/limits
 *
 * Creates or updates the credit terms of a customer. Body: { customer_id,
 * limit_amount, net_days, currency_code? }.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = bodyOf(req)
  const customerId = typeof body.customer_id === "string" ? body.customer_id.trim() : ""
  const amount = money(body.limit_amount)
  if (!customerId) {
    fail(res, 400, "customer_required", "Pick a customer.")
    return
  }
  if (amount === null) {
    fail(res, 400, "amount_required", "The limit needs an amount.")
    return
  }
  const row = await setLimit(req.scope, {
    customerId,
    limitAmount: amount,
    netDays: typeof body.net_days === "number" ? body.net_days : Number(body.net_days),
    currencyCode: typeof body.currency_code === "string" ? body.currency_code : null,
  })
  res.status(201).json({ limit: toLimit(row) })
}
