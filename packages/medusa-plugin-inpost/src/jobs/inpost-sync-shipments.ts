import type { MedusaContainer } from "@medusajs/framework/types"
import { SYNC_SCHEDULE } from "../modules/inpost/lib/constants"
import { inpostService } from "../workflows/inpost/runtime"
import { syncInpostShipmentsWorkflow } from "../workflows/inpost/workflows"

/**
 * THE STATUS PASS, every 15 minutes (minutes 7, 22, 37 and 52): the fallback
 * of the webhook. Open shipments are read again (each at most every 25
 * minutes), unknown creates looked up, and with the writers armed the
 * automatic steps run. Quiet when nothing changed; waits while InPost is not
 * configured. Demo mode moves the simulated shipments along.
 */
export default async function inpostSyncShipmentsJob(container: MedusaContainer): Promise<void> {
  const svc = inpostService(container)
  if (!svc.isConfigured()) return
  await syncInpostShipmentsWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "inpost-sync-shipments",
  schedule: SYNC_SCHEDULE,
}
