import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { runOlxSync, type SyncInput, type SyncResult } from "./run-sync"

/**
 * Reads the OLX adverts, matches them to product variants by SKU and stores
 * the snapshot. Read-only towards OLX: there is nothing to compensate.
 *
 * Run it from your own code, a subscriber or a job:
 *
 *   await syncOlxAdvertsWorkflow(container).run({ input: { trigger: "manual" } })
 */
export const syncOlxAdvertsStep = createStep(
  "olx-sync-adverts-step",
  async (input: SyncInput, { container }) => {
    const result: SyncResult = await runOlxSync(container, input)
    return new StepResponse(result)
  },
)

export const syncOlxAdvertsWorkflow = createWorkflow("olx-sync-adverts", (input: SyncInput) => {
  const result = syncOlxAdvertsStep(input)
  return new WorkflowResponse(result)
})
