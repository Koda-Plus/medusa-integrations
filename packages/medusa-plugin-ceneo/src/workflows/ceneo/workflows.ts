import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { runCeneoFeedBuild, type FeedBuildResult, type FeedTrigger } from "./build-feed"
import { runCeneoCategorySync, type CategorySyncResult } from "./categories"
import { runCeneoOrderSync } from "./orders"
import type { OrderSyncResult } from "../../modules/ceneo/lib/contract"

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
