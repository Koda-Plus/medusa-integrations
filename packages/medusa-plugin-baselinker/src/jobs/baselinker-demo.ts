import type { MedusaContainer } from "@medusajs/framework/types"
import { DEMO_SCHEDULE } from "../modules/baselinker/lib/constants"
import { runDemoTick } from "../workflows/baselinker/demo"
import { baselinkerService } from "../workflows/baselinker/runtime"

/**
 * DEMO MODE ONLY, EVERY MINUTE: builds the simulated snapshot when it is
 * missing and lets the simulated warehouse move sent orders on, so an
 * evaluator sees an order go from "Nowe" to "Wysłane" within minutes.
 * Idempotent, and quiet outside demo mode (it returns at once). The admin
 * reads never do this work: a read only reads.
 */
export default async function baselinkerDemoJob(container: MedusaContainer): Promise<void> {
  const svc = baselinkerService(container)
  if (!svc.isDemo()) return
  try {
    await runDemoTick(container)
  } catch (err) {
    svc.getLogger().error(`[baselinker] demo tick: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
}

export const config = {
  name: "baselinker-demo",
  schedule: DEMO_SCHEDULE,
}
