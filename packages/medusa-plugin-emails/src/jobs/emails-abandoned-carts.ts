import type { MedusaContainer } from "@medusajs/framework/types"
import { ABANDONED_SCHEDULE } from "../modules/emails/lib/constants"
import { runAbandonedCarts } from "../workflows/emails/abandoned-carts"

/**
 * Abandoned cart reminders, every hour at :20. Does nothing while the
 * `cart.abandoned` template is off (the default). Never throws.
 */
export default async function emailsAbandonedCarts(container: MedusaContainer): Promise<void> {
  try {
    await runAbandonedCarts(container)
  } catch {
    /* logged inside; a job must not crash the scheduler */
  }
}

export const config = {
  name: "emails-abandoned-carts",
  schedule: ABANDONED_SCHEDULE,
}
