import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { runOrderImport, type ImportRunInput } from "./run-import"
import { runInvoices } from "./run-invoices"
import { runIssues } from "./run-issues"
import { runPricePush } from "./run-prices"
import { runPublish } from "./run-publish"
import { runShipping } from "./run-shipping"
import { runStockPush, type WriterRunInput } from "./run-stock"

/**
 * The 0.2 runs as workflows, for the scheduled jobs, the admin and your own
 * code. Each one honors both switches of its writer by itself: calling it
 * directly is as safe as letting the schedule call it. `mode: "plan"` is a
 * dry run.
 *
 *   await pushAllegroStockWorkflow(container).run({ input: { mode: "plan" } })
 *
 * None of them is compensated: what they send to Allegro is either a
 * re-assertion of state (a quantity, a price, a status) that the next run
 * checks again, or a document sent exactly once through the outbox.
 */

export const pushAllegroStockStep = createStep("allegro-push-stock-step", async (input: WriterRunInput, { container }) => {
  return new StepResponse(await runStockPush(container, input))
})
export const pushAllegroStockWorkflow = createWorkflow("allegro-push-stock", (input: WriterRunInput) => new WorkflowResponse(pushAllegroStockStep(input)))

export const pushAllegroPricesStep = createStep("allegro-push-prices-step", async (input: WriterRunInput, { container }) => {
  return new StepResponse(await runPricePush(container, input))
})
export const pushAllegroPricesWorkflow = createWorkflow("allegro-push-prices", (input: WriterRunInput) => new WorkflowResponse(pushAllegroPricesStep(input)))

export const importAllegroOrdersStep = createStep("allegro-import-orders-step", async (input: ImportRunInput, { container }) => {
  return new StepResponse(await runOrderImport(container, input))
})
export const importAllegroOrdersWorkflow = createWorkflow("allegro-import-orders", (input: ImportRunInput) => new WorkflowResponse(importAllegroOrdersStep(input)))

export const pushAllegroShipmentsStep = createStep("allegro-push-shipments-step", async (input: { trigger?: string }, { container }) => {
  return new StepResponse(await runShipping(container, input))
})
export const pushAllegroShipmentsWorkflow = createWorkflow("allegro-push-shipments", (input: { trigger?: string }) => new WorkflowResponse(pushAllegroShipmentsStep(input)))

export const attachAllegroInvoicesStep = createStep("allegro-attach-invoices-step", async (input: { trigger?: string }, { container }) => {
  return new StepResponse(await runInvoices(container, input))
})
export const attachAllegroInvoicesWorkflow = createWorkflow("allegro-attach-invoices", (input: { trigger?: string }) => new WorkflowResponse(attachAllegroInvoicesStep(input)))

export const syncAllegroIssuesStep = createStep("allegro-sync-issues-step", async (input: { trigger?: string }, { container }) => {
  return new StepResponse(await runIssues(container, input))
})
export const syncAllegroIssuesWorkflow = createWorkflow("allegro-sync-issues", (input: { trigger?: string }) => new WorkflowResponse(syncAllegroIssuesStep(input)))

export const publishAllegroOffersStep = createStep("allegro-publish-offers-step", async (input: WriterRunInput, { container }) => {
  return new StepResponse(await runPublish(container, input))
})
export const publishAllegroOffersWorkflow = createWorkflow("allegro-publish-offers", (input: WriterRunInput) => new WorkflowResponse(publishAllegroOffersStep(input)))
