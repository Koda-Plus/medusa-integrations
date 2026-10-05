import type { MedusaContainer } from "@medusajs/framework/types"
import { ALLEGRO_MODULE, ISSUES_SCHEDULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { syncAllegroIssuesWorkflow } from "../workflows/allegro/writer-workflows"

/**
 * CUSTOMER ISSUES, TWICE AN HOUR, READ ONLY: returns, disputes, claims and
 * unread message threads. Quiet when not configured or not connected.
 */
export default async function allegroSyncIssuesJob(container: MedusaContainer): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  if (!svc.isDemo() && !svc.isConfigured()) return
  await syncAllegroIssuesWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "allegro-sync-issues",
  schedule: ISSUES_SCHEDULE,
}
