import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { runCatalogSync, type CatalogSyncInput, type CatalogSyncResult } from "./catalog"

/**
 * Reads the BaseLinker catalog, links cards to variants by SKU and EAN, stores
 * the snapshot and plans the stock (writes it only with `stockSync: "write"`).
 * Read-only towards BaseLinker: there is nothing to compensate.
 *
 *   await syncBaseLinkerCatalogWorkflow(container).run({ input: { trigger: "manual" } })
 */
export const syncBaseLinkerCatalogStep = createStep("baselinker-sync-catalog-step", async (input: CatalogSyncInput, { container }) => {
  const result: CatalogSyncResult = await runCatalogSync(container, input)
  return new StepResponse(result)
})

export const syncBaseLinkerCatalogWorkflow = createWorkflow("baselinker-sync-catalog", (input: CatalogSyncInput) => {
  return new WorkflowResponse(syncBaseLinkerCatalogStep(input))
})
