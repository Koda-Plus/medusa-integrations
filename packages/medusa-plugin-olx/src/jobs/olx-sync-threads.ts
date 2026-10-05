import type { MedusaContainer } from "@medusajs/framework/types"
import { THREADS_SCHEDULE } from "../modules/olx/lib/constants"
import { olxService } from "../api/admin/olx/helpers"
import { syncOlxThreadsWorkflow } from "../workflows/olx/workflows"

/**
 * MESSAGE THREADS, EVERY 15 MINUTES (at :10, :25, :40, :55): unread counts per
 * conversation and the advert it is about. Read only; the plugin keeps no
 * message text and no buyer id.
 */
export default async function olxSyncThreadsJob(container: MedusaContainer): Promise<void> {
  const svc = olxService(container)
  const o = svc.getOptions()
  if (!o.messagesEnabled) return
  if (!o.demo && !svc.isConfigured()) return
  await syncOlxThreadsWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "olx-sync-threads",
  schedule: THREADS_SCHEDULE,
}
