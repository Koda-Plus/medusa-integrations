import { createStep, createWorkflow, StepResponse, WorkflowResponse, type WorkflowData } from "@medusajs/framework/workflows-sdk"
import { cleanKey } from "../../modules/emails/lib/keys"
import { randomUUID } from "node:crypto"
import { sendTemplate, type SendOutcome } from "./send-template"
import { runAbandonedCarts, type AbandonedRun } from "./abandoned-carts"

export interface SendEmailWorkflowInput {
  /** A template key: built-in ("order.placed") or yours ("company.approved"). */
  template: string
  to: string
  data?: Record<string, unknown>
  /** "pl", "en" or a tag such as "pl-PL"; the data's `locale` or `defaultLocale` when missing. */
  locale?: string
  /**
   * The identity of the event, e.g. "company.approved:comp_123": the same
   * key never sends twice. Without one every run sends.
   */
  idempotencyKey?: string
  resourceType?: string
  resourceId?: string
  orderId?: string
}

/**
 * Sends one template through the notification module, like the plugin's own
 * subscribers: the template's switch first, then the provider with the
 * idempotency key. Never fails the workflow because an e-mail did not go
 * out; the result says what happened.
 */
export const sendEmailStep = createStep("emails-send-email-step", async (input: SendEmailWorkflowInput, { container }) => {
  const key = cleanKey(input.idempotencyKey ? `emails:${input.template}:${input.idempotencyKey}` : null) ?? `emails:${input.template}:${randomUUID()}`
  const outcome: SendOutcome = await sendTemplate(container, {
    template: input.template,
    to: input.to,
    data: { ...(input.data ?? {}), ...(input.locale ? { locale: input.locale } : {}) },
    key,
    trigger: "workflow",
    kind: "app",
    resource: input.resourceType && input.resourceId ? { type: input.resourceType, id: input.resourceId } : null,
    orderId: input.orderId ?? null,
  })
  return new StepResponse({ status: outcome.status, key })
})

export const sendEmailWorkflow = createWorkflow("emails-send-email", (input: WorkflowData<SendEmailWorkflowInput>) => {
  const result = sendEmailStep(input)
  return new WorkflowResponse(result)
})

const abandonedCartsStep = createStep("emails-abandoned-carts-step", async (_input: Record<string, never>, { container }) => {
  const run: AbandonedRun | null = await runAbandonedCarts(container)
  return new StepResponse(run)
})

/** The abandoned cart reminders, as the hourly job runs them. Does nothing while the template is off. */
export const sendAbandonedCartsWorkflow = createWorkflow("emails-abandoned-carts", (input: WorkflowData<Record<string, never>>) => {
  const run = abandonedCartsStep(input)
  return new WorkflowResponse(run)
})
