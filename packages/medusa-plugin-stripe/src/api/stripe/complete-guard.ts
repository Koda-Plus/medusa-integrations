import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { decideByStatus, pendingStripeIntent, type GuardSession } from "../../modules/stripe/lib/complete-guard"
import { clientFor, queryOf, stripeService } from "../../workflows/stripe/runtime"

/**
 * POST /store/carts/:id/complete: a Stripe cart completes only when its
 * PaymentIntent is paid, so a failed attempt never burns an order number.
 * See lib/complete-guard.ts. Every doubt lets the request through.
 */
export function stripeCompleteGuard() {
  return async (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    let svc: ReturnType<typeof stripeService> | null = null
    try {
      svc = stripeService(req.scope)
      const o = svc.getOptions()
      const cartId = String((req.params as Record<string, string> | undefined)?.id ?? "")
      if (o.demo || !o.apiKey || !/^cart_[A-Za-z0-9]+$/.test(cartId)) return next()

      const { data } = await queryOf(req.scope).graph({
        entity: "cart",
        fields: [
          "id",
          "completed_at",
          "payment_collection.payment_sessions.provider_id",
          "payment_collection.payment_sessions.status",
          "payment_collection.payment_sessions.data",
          "payment_collection.payment_sessions.created_at",
        ],
        filters: { id: cartId },
      })
      const cart = data[0] as { completed_at?: unknown; payment_collection?: { payment_sessions?: GuardSession[] } } | undefined
      /* A completed cart answers with its order (Medusa is idempotent here); an unknown cart gets Medusa's own 404. */
      if (!cart || cart.completed_at) return next()

      const intentId = pendingStripeIntent(cart.payment_collection?.payment_sessions)
      if (!intentId) return next()

      const intent = await clientFor(req.scope, svc).get<{ status?: string }>(`/payment_intents/${intentId}`)
      const decision = decideByStatus(intent?.status)
      if (decision.allow) return next()

      svc.getLogger().info(`[stripe] Cart ${cartId} not completed: its PaymentIntent is ${decision.status} (no order, no order number used).`)
      res.status(409).json({ type: "not_allowed", code: decision.code, payment_status: decision.status, message: decision.message })
      return
    } catch (err) {
      svc?.getLogger().warn(`[stripe] The completion guard could not read the payment and let the request through: ${String((err as Error)?.message ?? err).slice(0, 200)}`)
      return next()
    }
  }
}
