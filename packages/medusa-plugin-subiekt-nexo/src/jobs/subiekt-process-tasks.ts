import type { MedusaContainer } from "@medusajs/framework/types"
import { TASKS_SCHEDULE } from "../modules/subiekt/lib/constants"
import { subiektService } from "../workflows/subiekt/runtime"
import { processSubiektTasksWorkflow } from "../workflows/subiekt/process-subiekt-tasks"

/**
 * THE QUEUE, EVERY MINUTE: due ZK, cancels and WZ requests, including the
 * retries of earlier failures. Subscribers already start a pass right after
 * each event; this job is the safety net and the retry clock. Quiet when
 * nothing is due (no run is recorded for an empty pass).
 */
export default async function subiektProcessTasksJob(container: MedusaContainer): Promise<void> {
  const svc = subiektService(container)
  if (!svc.isDemo() && !svc.isConfigured()) return
  await processSubiektTasksWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "subiekt-process-tasks",
  schedule: TASKS_SCHEDULE,
}
