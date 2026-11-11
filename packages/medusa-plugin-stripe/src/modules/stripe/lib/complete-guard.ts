/**
 * NO BURNT ORDER NUMBERS: a cart paid through Stripe completes only once
 * Stripe says the money is there.
 *
 * Medusa's completeCartWorkflow creates the order (and takes the next
 * display_id from a Postgres sequence) before it authorizes the payment. When
 * the storefront asks to complete a cart whose PaymentIntent is still
 * `processing` (BLIK, Przelewy24), waits for 3-D Secure, or failed, the
 * authorization fails, the order is rolled back and the number is gone: the
 * shop's orders jump from #103 to #125. A sequence never gives a number back.
 *
 * The guard stands in front of `POST /store/carts/:id/complete` and reads the
 * PaymentIntent of the cart's pending Stripe session first:
 *
 *   succeeded, requires_capture   the request goes on, Medusa places the order
 *   processing                    409 payment_processing: Stripe's webhook
 *                                 places the order when the money arrives
 *   anything else                 409 payment_not_completed (3-D Secure not
 *                                 done, card declined, cancelled)
 *
 * It never stops a sale it cannot judge: no Stripe session, a completed cart,
 * demo mode, no key, or Stripe not answering all let the request through, as
 * before. The webhook path (payment_intent.succeeded) does not pass through
 * this route, so it keeps placing orders by itself.
 */

export type PaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "canceled"
  | "succeeded"
  | string

export type CompleteDecision =
  | { allow: true; reason: string }
  | { allow: false; code: "payment_processing" | "payment_not_completed"; status: string; message: string }

/** What a PaymentIntent status means for completing the cart now. */
export function decideByStatus(status: PaymentIntentStatus | null | undefined): CompleteDecision {
  if (!status) return { allow: true, reason: "unknown status" }
  if (status === "succeeded" || status === "requires_capture") return { allow: true, reason: status }
  if (status === "processing") {
    return {
      allow: false,
      code: "payment_processing",
      status,
      message: "The payment is still being processed. The order is placed automatically as soon as Stripe confirms it; do not pay again.",
    }
  }
  return {
    allow: false,
    code: "payment_not_completed",
    status,
    message: "The payment is not completed yet, so no order was placed. Finish the payment (for example 3-D Secure) or try again.",
  }
}

export interface GuardSession {
  provider_id?: string | null
  status?: string | null
  data?: Record<string, unknown> | null
  created_at?: string | Date | null
}

/** The PaymentIntent id of the cart's newest pending Stripe session, or null when the cart does not pay through Stripe. */
export function pendingStripeIntent(sessions: readonly GuardSession[] | null | undefined): string | null {
  const stripe = (sessions ?? []).filter(
    (s) => typeof s?.provider_id === "string" && s.provider_id.startsWith("pp_stripe") && s.status !== "canceled" && s.status !== "error",
  )
  stripe.sort((a, b) => new Date(String(b.created_at ?? 0)).getTime() - new Date(String(a.created_at ?? 0)).getTime())
  for (const s of stripe) {
    const id = s.data?.id
    if (typeof id === "string" && /^pi_[A-Za-z0-9_]+$/.test(id)) return id
  }
  return null
}
