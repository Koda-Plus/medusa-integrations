import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { creditSvc, toLimit } from "../../../../../modules/credit/lib/store"
import { bodyOf, fail, money } from "../../../../credit/helpers"
import { accountToLimit } from "../../../../../modules/credit/lib/store-mode"

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
    patch.limit_amount = creditSvc(req.scope).getOptions?.()?.store ? Math.round(amount * 100) / 100 : Math.floor(amount)
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
  /* Store mode: the id is the customer; the store validates, clamps and writes. */
  const store = svc.getOptions?.()?.store
  if (store) {
    await store.update(
      req.scope,
      id,
      {
        ...(patch.limit_amount !== undefined ? { limit_amount: patch.limit_amount === 0 ? null : (patch.limit_amount as number) } : {}),
        ...(patch.net_days !== undefined ? { net_days: patch.net_days as number } : {}),
        ...(patch.blocked !== undefined && store.capabilities?.block ? { blocked: patch.blocked as boolean } : {}),
        ...(patch.status !== undefined && store.capabilities?.pause ? { paused: patch.status === "paused" } : {}),
      },
      { id: actorOf(req) },
    )
    const account = (await store.accounts(req.scope)).find((a) => a.customer_id === id)
    res.json({ limit: account ? accountToLimit(account) : null })
    return
  }
  const updated = await svc.updateCreditLimits([patch])
  res.json({ limit: toLimit(updated[0]) })
}

/** The admin user who made the change (store mode passes it to the store). */
function actorOf(req: MedusaRequest): string | null {
  const ctx = (req as MedusaRequest & { auth_context?: { actor_id?: string | null } | null }).auth_context
  return typeof ctx?.actor_id === "string" ? ctx.actor_id : null
}
