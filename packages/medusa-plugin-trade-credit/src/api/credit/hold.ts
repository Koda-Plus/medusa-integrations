import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { creditHold } from "../../modules/credit/lib/credit"
import { creditSvc } from "../../modules/credit/lib/store"

const MESSAGE: Record<string, string> = {
  blocked: "Your trade credit is blocked. Please contact the store to complete this order.",
  paused: "Your trade credit is paused. Please contact the store to complete this order.",
  over_limit: "This order would pass your trade credit limit. Pay the open invoices or contact the store.",
}

/**
 * `enforce: true`: POST /store/carts/:id/complete answers 403 `credit_hold`
 * when the cart's customer has credit terms and is blocked, paused, or would
 * pass the limit with this order. Customers without terms, guest carts, store
 * mode and `enforce: false` pass untouched. A failed read never blocks a sale.
 */
export async function creditHoldMiddleware(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): Promise<void> {
  try {
    const svc = creditSvc(req.scope)
    if (!svc.getOptions?.()?.enforce) return next()
    const cartId = String((req.params as Record<string, string> | undefined)?.id ?? "")
    if (!cartId) return next()
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as { graph: (q: Record<string, unknown>) => Promise<{ data: any[] }> }
    const { data } = await query.graph({ entity: "cart", fields: ["id", "customer_id", "total"], filters: { id: cartId } })
    const cart = data?.[0]
    const customerId = typeof cart?.customer_id === "string" ? cart.customer_id : null
    if (!customerId) return next()
    const limits = await svc.listCreditLimits({ customer_id: customerId }, { take: 1 })
    if (!limits.length) return next()
    const l = limits[0]
    const hold = creditHold(
      { limit_amount: Number(l.limit_amount ?? 0), used_amount: Number(l.used_amount ?? 0), status: l.status === "paused" ? "paused" : "active", blocked: l.blocked === true },
      Number(cart?.total ?? 0),
    )
    if (!hold) return next()
    res.status(403).json({ type: "not_allowed", code: "credit_hold", reason: hold.reason, remaining_amount: hold.remaining_amount, order_amount: hold.order_amount, message: MESSAGE[hold.reason] })
  } catch (err) {
    console.warn(`[credit] credit hold check skipped: ${(err as Error).message}`)
    next()
  }
}
