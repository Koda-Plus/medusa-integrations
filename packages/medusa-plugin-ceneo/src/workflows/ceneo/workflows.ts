import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { runCeneoFeedBuild, type FeedBuildResult, type FeedTrigger } from "./build-feed"
import { runCeneoCategorySync, type CategorySyncResult } from "./categories"
import { runCeneoOrderSync } from "./orders"
import { runCeneoImport, runCeneoWrites } from "./import-orders"
import { runCeneoCpc } from "./cpc"
import type { CpcRunResult, KupTerazRunResult, OrderSyncResult } from "../../modules/ceneo/lib/contract"

/**
 * The feed build as a workflow, for the job, the admin and your own code:
 *
 *   await buildCeneoFeedWorkflow(container).run({ input: { trigger: "manual" } })
 *
 * A single step: a build writes snapshots (the offer rows, one build row)
 * that the next build rewrites anyway, so there is nothing a compensation
 * could undo better.
 */
export const buildCeneoFeedStep = createStep("ceneo-build-feed-step", async (input: { trigger?: FeedTrigger }, { container }) => {
  const result: FeedBuildResult = await runCeneoFeedBuild(container, input)
  return new StepResponse(result)
})

export const buildCeneoFeedWorkflow = createWorkflow("ceneo-build-feed", (input: { trigger?: FeedTrigger }) => {
  return new WorkflowResponse(buildCeneoFeedStep(input))
})

/**
 * The Ceneo category tree, downloaded and written where it changed:
 *
 *   await syncCeneoCategoriesWorkflow(container).run({ input: { trigger: "manual" } })
 */
export const syncCeneoCategoriesStep = createStep("ceneo-sync-categories-step", async (input: { trigger?: string }, { container }) => {
  const result: CategorySyncResult = await runCeneoCategorySync(container, input)
  return new StepResponse(result)
})

export const syncCeneoCategoriesWorkflow = createWorkflow("ceneo-sync-categories", (input: { trigger?: string }) => {
  return new WorkflowResponse(syncCeneoCategoriesStep(input))
})

/**
 * Kup Teraz orders read from Ceneo into `ceneo_order` (no Medusa order is
 * created here):
 *
 *   await syncCeneoOrdersWorkflow(container).run({ input: { trigger: "manual" } })
 */
export const syncCeneoOrdersStep = createStep("ceneo-sync-orders-step", async (input: { trigger?: string }, { container }) => {
  const result: OrderSyncResult = await runCeneoOrderSync(container, input)
  return new StepResponse(result)
})

export const syncCeneoOrdersWorkflow = createWorkflow("ceneo-sync-orders", (input: { trigger?: string }) => {
  return new WorkflowResponse(syncCeneoOrdersStep(input))
})

/**
 * Kup Teraz writes: stored orders into Medusa (the orders writer), then what
 * Ceneo should learn (the status writer). Each part does nothing unless its
 * writer is armed with both switches on:
 *
 *   await importCeneoOrdersWorkflow(container).run({ input: { trigger: "manual" } })
 *
 * One step: every order is claimed and finished on its own, and a Medusa
 * order created for one Ceneo order is never undone because another failed.
 */
export const importCeneoOrdersStep = createStep("ceneo-import-orders-step", async (input: { trigger?: string }, { container }) => {
  /* Each part on its own: a failing import never keeps Ceneo from hearing about shipments. */
  const imported: KupTerazRunResult["import"] = await runCeneoImport(container, input).catch((err: unknown) => ({ status: "failed" as const, error: err instanceof Error ? err.message : String(err) }))
  const writes: KupTerazRunResult["writes"] = await runCeneoWrites(container, input).catch((err: unknown) => ({ status: "failed" as const, error: err instanceof Error ? err.message : String(err) }))
  const result: KupTerazRunResult = { import: imported, writes }
  return new StepResponse(result)
})

export const importCeneoOrdersWorkflow = createWorkflow("ceneo-import-orders", (input: { trigger?: string }) => {
  return new WorkflowResponse(importCeneoOrdersStep(input))
})

/**
 * CPC: bids and the top 10 read, then one planned bid step and the changed
 * promotion texts, each only when its writer is armed:
 *
 *   await runCeneoCpcWorkflow(container).run({ input: { trigger: "manual" } })
 */
export const runCeneoCpcStep = createStep("ceneo-cpc-step", async (input: { trigger?: string }, { container }) => {
  const result: CpcRunResult = await runCeneoCpc(container, input)
  return new StepResponse(result)
})

export const runCeneoCpcWorkflow = createWorkflow("ceneo-cpc", (input: { trigger?: string }) => {
  return new WorkflowResponse(runCeneoCpcStep(input))
})
