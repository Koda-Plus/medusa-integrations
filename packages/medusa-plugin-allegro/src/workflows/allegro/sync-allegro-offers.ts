import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { runAllegroOffersSync, type SyncInput, type SyncResult } from "./run-offers"

/**
 * Reads the Allegro offers, matches them to product variants by signature,
 * runs the stock check and stores the snapshot. Read-only towards Allegro:
 * there is nothing to compensate.
 *
 *   await syncAllegroOffersWorkflow(container).run({ input: { trigger: "manual" } })
 */
export const syncAllegroOffersStep = createStep(
  "allegro-sync-offers-step",
  async (input: SyncInput, { container }) => {
    const result: SyncResult = await runAllegroOffersSync(container, input)
    return new StepResponse(result)
  },
)

export const syncAllegroOffersWorkflow = createWorkflow("allegro-sync-offers", (input: SyncInput) => {
  const result = syncAllegroOffersStep(input)
  return new WorkflowResponse(result)
})
