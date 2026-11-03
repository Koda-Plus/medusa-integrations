import type { MedusaContainer } from "@medusajs/framework/types"
import { CATCH_UP_SCHEDULE } from "../modules/subiekt/lib/constants"
import { runCatchUp } from "../workflows/subiekt/catch-up"
import { subiektService } from "../workflows/subiekt/runtime"

/**
 * THE SAFETY NET, EVERY 10 MINUTES: recent orders (by default 10 minutes to
 * 7 days old) that have neither a ZK task nor a ZK get their task, with the
 * same payment rule as `order.placed`. Off with `catchUpEnabled: false`.
 * Records a run only when it queued something.
 */
export default async function subiektCatchUpJob(container: MedusaContainer): Promise<void> {
  const svc = subiektService(container)
  if (!svc.getOptions().catchUpEnabled) return
  if (!svc.isDemo() && !svc.isConfigured()) return
  await runCatchUp(container, "schedule")
}

export const config = {
  name: "subiekt-catch-up",
  schedule: CATCH_UP_SCHEDULE,
}
