/**
 * MEDUSA WORKFLOWS AROUND THE MOVES, for custom code: an app can open a
 * negotiation from its own page, a subscriber can accept on a rule, a script
 * can run the expiry pass.
 *
 *   const { result } = await counterNegotiationWorkflow(container).run({
 *     input: { id: "neg_01J...", user_id: "user_01J...", price: "469.00", message: "Best I can do" },
 *   })
 *
 * Each result is the thread after the move in the shape of the event data
 * (`NegotiationEventData`), the same the events carry.
 *
 * DELIBERATELY WITHOUT COMPENSATIONS. A move is a conversation: a message
 * the customer may already have read, an event a subscriber already handled.
 * It is never silently undone; a later move answers it instead. Every move
 * is one conditional write, so a retried step either finds the move done
 * (409, nothing written twice) or writes it once.
 */

import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { DraftRunResponse, RunDto } from "../../modules/negotiations/lib/contract"
import { eventData, type NegotiationEventData } from "../../modules/negotiations/lib/events"
import { runDraftOrders } from "./draft-orders"
import { expireNegotiations } from "./expire"
import {
  adminAccept,
  adminCounter,
  adminMessage,
  adminReject,
  customerAccept,
  customerDecline,
  customerMessage,
  openNegotiation,
  type MoveResult,
} from "./threads"

function summary(r: MoveResult, actor: "customer" | "admin", actorId: string | null): NegotiationEventData {
  return eventData(r.thread, { previousStatus: r.previous, actor, actorId, messageId: r.message?.id ?? null })
}

/* ------------------------------------------------------------------ */

export interface OpenNegotiationInput {
  customer_id: string
  product_id?: string
  variant_id?: string
  cart_id?: string
  quantity?: number
  /** Decimal text in major units, like "469.00". */
  target_price?: string | number
  currency_code?: string
  message: string
  /** Sales channels the product must be in (a storefront's publishable key). */
  sales_channel_ids?: string[]
}

export const openNegotiationStep = createStep("negotiations-open-step", async (input: OpenNegotiationInput, { container }) => {
  const { customer_id, sales_channel_ids, ...body } = input
  const r = await openNegotiation(container, { customerId: customer_id, body, salesChannelIds: sales_channel_ids ?? null })
  return new StepResponse(summary(r, "customer", customer_id))
})

export const openNegotiationWorkflow = createWorkflow("negotiations-open", (input: OpenNegotiationInput) => {
  return new WorkflowResponse(openNegotiationStep(input))
})

/* ------------------------------------------------------------------ */

export interface AddNegotiationMessageInput {
  id: string
  /** Who writes: the customer (by `customer_id`) or the team (by `user_id`). */
  author: "customer" | "admin"
  customer_id?: string
  user_id?: string
  message: string
  /** A customer's new target price; moves a countered thread back to open. */
  target_price?: string | number
}

export const addNegotiationMessageStep = createStep("negotiations-message-step", async (input: AddNegotiationMessageInput, { container }) => {
  if (input.author === "customer") {
    const r = await customerMessage(container, { customerId: input.customer_id ?? "", id: input.id, body: { message: input.message, target_price: input.target_price } })
    return new StepResponse(summary(r, "customer", input.customer_id ?? null))
  }
  const r = await adminMessage(container, { id: input.id, actorId: input.user_id ?? null, body: { message: input.message } })
  return new StepResponse(summary(r, "admin", input.user_id ?? null))
})

export const addNegotiationMessageWorkflow = createWorkflow("negotiations-message", (input: AddNegotiationMessageInput) => {
  return new WorkflowResponse(addNegotiationMessageStep(input))
})

/* ------------------------------------------------------------------ */

export interface CounterNegotiationInput {
  id: string
  user_id?: string
  /** Decimal text in major units: per unit, or for the whole cart. */
  price: string | number
  message?: string
  valid_days?: number
}

export const counterNegotiationStep = createStep("negotiations-counter-step", async (input: CounterNegotiationInput, { container }) => {
  const r = await adminCounter(container, { id: input.id, actorId: input.user_id ?? null, body: { price: input.price, message: input.message, valid_days: input.valid_days } })
  return new StepResponse(summary(r, "admin", input.user_id ?? null))
})

export const counterNegotiationWorkflow = createWorkflow("negotiations-counter", (input: CounterNegotiationInput) => {
  return new WorkflowResponse(counterNegotiationStep(input))
})

/* ------------------------------------------------------------------ */

export interface AcceptNegotiationInput {
  id: string
  /** The customer accepts the counter offer; the team accepts the price on the table. */
  by: "customer" | "admin"
  customer_id?: string
  user_id?: string
  /** The price the accepting side saw; the accept is refused when it changed. */
  price?: string | number
  message?: string
}

export const acceptNegotiationStep = createStep("negotiations-accept-step", async (input: AcceptNegotiationInput, { container }) => {
  const body = { price: input.price, message: input.message }
  if (input.by === "customer") {
    const r = await customerAccept(container, { customerId: input.customer_id ?? "", id: input.id, body })
    return new StepResponse(summary(r, "customer", input.customer_id ?? null))
  }
  const r = await adminAccept(container, { id: input.id, actorId: input.user_id ?? null, body })
  return new StepResponse(summary(r, "admin", input.user_id ?? null))
})

export const acceptNegotiationWorkflow = createWorkflow("negotiations-accept", (input: AcceptNegotiationInput) => {
  return new WorkflowResponse(acceptNegotiationStep(input))
})

/* ------------------------------------------------------------------ */

export interface RejectNegotiationInput {
  id: string
  /** The team rejects; the customer declines. */
  by: "customer" | "admin"
  customer_id?: string
  user_id?: string
  message?: string
}

export const rejectNegotiationStep = createStep("negotiations-reject-step", async (input: RejectNegotiationInput, { container }) => {
  const body = { message: input.message }
  if (input.by === "customer") {
    const r = await customerDecline(container, { customerId: input.customer_id ?? "", id: input.id, body })
    return new StepResponse(summary(r, "customer", input.customer_id ?? null))
  }
  const r = await adminReject(container, { id: input.id, actorId: input.user_id ?? null, body })
  return new StepResponse(summary(r, "admin", input.user_id ?? null))
})

export const rejectNegotiationWorkflow = createWorkflow("negotiations-reject", (input: RejectNegotiationInput) => {
  return new WorkflowResponse(rejectNegotiationStep(input))
})

/* ------------------------------------------------------------------ */

export const expireNegotiationsStep = createStep("negotiations-expire-step", async (_input: Record<string, never>, { container }) => {
  const run: RunDto | null = await expireNegotiations(container, "manual")
  return new StepResponse(run)
})

export const expireNegotiationsWorkflow = createWorkflow("negotiations-expire", (input: Record<string, never>) => {
  return new WorkflowResponse(expireNegotiationsStep(input))
})

/* ------------------------------------------------------------------ */

export interface RunDraftOrdersInput {
  /** Only plan: the exact inputs, nothing created. */
  dry_run?: boolean
}

export const runNegotiationDraftOrdersStep = createStep("negotiations-draft-orders-step", async (input: RunDraftOrdersInput, { container }) => {
  const result: DraftRunResponse = await runDraftOrders(container, { dryRun: input.dry_run === true, trigger: "manual" })
  return new StepResponse(result)
})

export const runNegotiationDraftOrdersWorkflow = createWorkflow("negotiations-draft-orders", (input: RunDraftOrdersInput) => {
  return new WorkflowResponse(runNegotiationDraftOrdersStep(input))
})
