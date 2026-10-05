import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onPaymentCaptured } from "../workflows/fakturownia/events"

/**
 * A captured payment (`{ id }` is the payment): with the default
 * `trigger: "payment_captured"` an order captured in full gets its first
 * document queued, and with `markPaidOnCapture` its unpaid documents are
 * marked paid in Fakturownia (after an amount check). Never fails the capture.
 */
export default async function fakturowniaPaymentCaptured({ event: { data }, container }: SubscriberArgs<{ id: string }>): Promise<void> {
  if (!data?.id) return
  await onPaymentCaptured(container, data.id)
}

export const config: SubscriberConfig = {
  event: "payment.captured",
  context: { subscriberId: "fakturownia-payment-captured" },
}
