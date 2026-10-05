import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { runAllegroOrdersSync } from "./run-orders"
import type { SyncInput, SyncResult } from "./run-offers"

/**
 * Reads the Allegro orders changed since the last complete read and stores
 * them in the read-only journal, every line linked to its product. No
 * personal data is stored. Read-only towards Allegro.
 *
 *   await syncAllegroOrdersWorkflow(container).run({ input: { trigger: "manual" } })
 */
export const syncAllegroOrdersStep = createStep(
  "allegro-sync-orders-step",
  async (input: SyncInput, { container }) => {
    const result: SyncResult = await runAllegroOrdersSync(container, input)
    return new StepResponse(result)
  },
)

export const syncAllegroOrdersWorkflow = createWorkflow("allegro-sync-orders", (input: SyncInput) => {
  const result = syncAllegroOrdersStep(input)
  return new WorkflowResponse(result)
})
