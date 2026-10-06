import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { onPasswordReset, type PasswordResetEvent } from "../workflows/emails/events"

/**
 * Password reset (`auth.password_reset`, payload `{ entity_id, actor_type,
 * token, metadata }`): customers get a link to the storefront's reset page,
 * admin users to the admin's. The token is never logged. Never throws.
 */
export default async function emailsPasswordReset({ event: { data }, container }: SubscriberArgs<PasswordResetEvent>): Promise<void> {
  if (!data) return
  await onPasswordReset(container, data)
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
  context: { subscriberId: "emails-password-reset" },
}
