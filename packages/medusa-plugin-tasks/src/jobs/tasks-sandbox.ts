import type { MedusaContainer } from "@medusajs/framework/types"
import { ensureSandbox } from "../workflows/tasks/sandbox"
import { tasksService } from "../workflows/tasks/runtime"

/**
 * THE SANDBOX BOARD, BACK TO ITS SAMPLE TASKS: every hour at minute 5, when
 * sandbox accounts are configured and the seed is older than
 * `sandboxResetHours` (or was never made). Reads never seed, so this job and
 * the Tasks page of a sandbox account are the only places that do. Several
 * instances seed once: the marker is checked again under the board's lock.
 */
export default async function tasksSandboxJob(container: MedusaContainer): Promise<void> {
  let configured = false
  try {
    configured = tasksService(container).getOptions().sandboxAccounts.length > 0
  } catch {
    return
  }
  if (!configured) return
  await ensureSandbox(container, null)
}

export const config = {
  name: "tasks-sandbox",
  schedule: "5 * * * *",
}
