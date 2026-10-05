import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { RunTrigger } from "../../modules/baselinker/lib/contract"
import { runOrderImport, type ImportPassStats } from "./order-import"

export interface ImportOrdersInput {
  trigger: RunTrigger
}

/**
 * One pass of the marketplace order import: discovery of new BaseLinker
 * orders of the chosen sources, then (only while the `orderImport` writer is
 * armed) one Medusa order per BaseLinker order, exactly once.
 *
 * DELIBERATELY WITHOUT A COMPENSATION: each order is its own unit (Medusa's
 * workflows inside roll a failed order back), and an imported order must not
 * vanish because the next one failed. A retry is safe: every attempt looks
 * the order up in Medusa before it creates anything.
 */
export const importBaseLinkerOrdersStep = createStep("baselinker-import-orders-step", async (input: ImportOrdersInput, { container }) => {
  const stats: ImportPassStats | null = await runOrderImport(container, input.trigger)
  return new StepResponse(stats)
})

export const importBaseLinkerOrdersWorkflow = createWorkflow("baselinker-import-orders", (input: ImportOrdersInput) => {
  return new WorkflowResponse(importBaseLinkerOrdersStep(input))
})
