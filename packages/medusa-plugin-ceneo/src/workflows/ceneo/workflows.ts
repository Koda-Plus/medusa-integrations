import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { runCeneoFeedBuild, type FeedBuildResult, type FeedTrigger } from "./build-feed"

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
