import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { creditSvc, toLimit } from "../../../../../modules/credit/lib/store"
import { bodyOf, fail, money } from "../../../../credit/helpers"

/**
 * POST /admin/credit/limits/:id
 *
 * Changes the amount, the terms or the toggles of a limit. Body parts are
 * optional: { limit_amount?, net_days?, blocked?, status? }.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = creditSvc(req.scope)
  const id = req.params.id as string
  const body = bodyOf(req)
  const patch: Record<string, unknown> = { id }
  if (body.limit_amount !== undefined) {
    const amount = money(body.limit_amount)
    if (amount === null) {
      fail(res, 400, "amount_invalid", "The limit needs an amount.")
      return
    }
    patch.limit_amount = Math.floor(amount)
  }
  if (body.net_days !== undefined) {
    const n = typeof body.net_days === "string" ? Number(body.net_days.trim()) : Number(body.net_days)
    patch.net_days = Number.isFinite(n) ? Math.min(365, Math.max(0, Math.floor(n))) : 0
  }
  if (body.blocked !== undefined) patch.blocked = body.blocked === true || body.blocked === "true"
  if (body.status === "active" || body.status === "paused") patch.status = body.status
  if (Object.keys(patch).length === 1) {
    fail(res, 400, "nothing_to_change", "Nothing to change.")
    return
  }
  const updated = await svc.updateCreditLimits([patch])
  res.json({ limit: toLimit(updated[0]) })
}
