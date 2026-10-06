import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { NegotiationEvent } from "../modules/emails/lib/data"
import { onNegotiation } from "../workflows/emails/events"

/**
 * The events of @koda-plus/medusa-plugin-negotiations, by name only (no
 * dependency on that package): a counter offer, an agreed price, a closed
 * negotiation. The three templates are off until turned on. A negotiation
 * flagged `demo` never e-mails anyone outside demo mode. Never throws.
 */
export default async function emailsNegotiations({ event: { name, data }, container }: SubscriberArgs<NegotiationEvent>): Promise<void> {
  if (!data?.id) return
  await onNegotiation(container, name, data)
}

export const config: SubscriberConfig = {
  event: ["negotiation.countered", "negotiation.accepted", "negotiation.rejected"],
  context: { subscriberId: "emails-negotiations" },
}
