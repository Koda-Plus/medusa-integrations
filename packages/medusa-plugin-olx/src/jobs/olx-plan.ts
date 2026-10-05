import type { MedusaContainer } from "@medusajs/framework/types"
import { PLAN_SCHEDULE } from "../modules/olx/lib/constants"
import { olxService } from "../api/admin/olx/helpers"
import { runOlxCycleWorkflow } from "../workflows/olx/workflows"

/**
 * ALERTS, PLANS AND THE ARMED WRITERS, EVERY 15 MINUTES (at :05, :20, :35, :50).
 *
 * No request for the advert list: the plan compares the last snapshot with
 * the current Medusa stock, prices and product statuses, so an item that sold
 * out in the store shows up within a quarter of an hour, and an armed
 * lifecycle writer ends its advert (after reading it on OLX first).
 */
export default async function olxPlanJob(container: MedusaContainer): Promise<void> {
  const svc = olxService(container)
  const o = svc.getOptions()
  if (!o.syncEnabled) return
  if (!o.demo && !svc.isConfigured()) return
  await runOlxCycleWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "olx-plan",
  schedule: PLAN_SCHEDULE,
}
