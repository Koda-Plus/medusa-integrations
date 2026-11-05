import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { LabelPage } from "../../modules/dpd/lib/constants"
import type { ShipmentRow } from "../../modules/dpd/lib/dto"
import { createShipment } from "./create"
import { runShipmentPass, type PassResult } from "./resolve"
import { recordFulfillment } from "./shipments"

/**
 * The flows as Medusa workflows, for your own code:
 *
 *   import { createDpdShipmentWorkflow } from "@koda-plus/medusa-plugin-dpd/workflows"
 *   await createDpdShipmentWorkflow(container).run({ input: { shipmentId, planHash } })
 *
 * They follow the same rules as the admin: creating a shipment needs the
 * shipment writer allowed in the options and armed in Settings, and a plan
 * without problems. A refusal or an unclear answer of DPD is not an error:
 * the row comes back in its new state.
 */

export type RecordDpdFulfillmentInput = {
  orderId: string
  fulfillmentId: string
}

/** Records the DPD row of a fulfillment (what the subscriber of order.fulfillment_created does). Null for another provider. */
export const recordDpdFulfillmentStep = createStep("dpd-record-fulfillment-step", async (input: RecordDpdFulfillmentInput, { container }) => {
  const row: ShipmentRow | null = await recordFulfillment(container, input.orderId, input.fulfillmentId)
  return new StepResponse(row)
})

export const recordDpdFulfillmentWorkflow = createWorkflow("dpd-record-fulfillment", (input: RecordDpdFulfillmentInput) => {
  return new WorkflowResponse(recordDpdFulfillmentStep(input))
})

export type CreateDpdShipmentInput = {
  /** The dpd_shipment row (`dpdshp_...`). */
  shipmentId: string
  /** The hash of the plan a person read; without it the run is automatic (the plan is sent as it is now). */
  planHash?: string | null
  /** The label page; default the one in Settings. */
  page?: LabelPage | null
  /** Who asks: an admin user id, or "system". */
  actor?: string | null
}

/** Creates the DPD shipment of a pending or failed row and gets its label. Throws when the writer is not armed or the plan has problems. */
export const createDpdShipmentStep = createStep("dpd-create-shipment-step", async (input: CreateDpdShipmentInput, { container }) => {
  const row: ShipmentRow = await createShipment(container, input.shipmentId, {
    planHash: input.planHash ?? null,
    page: input.page ?? null,
    actor: input.actor ?? "system",
    trigger: input.planHash ? "manual" : "auto",
  })
  return new StepResponse(row)
})

export const createDpdShipmentWorkflow = createWorkflow("dpd-create-shipment", (input: CreateDpdShipmentInput) => {
  return new WorkflowResponse(createDpdShipmentStep(input))
})

export type RunDpdShipmentPassInput = Record<string, never>

/** The periodic pass (what the job runs every 5 minutes). `ran: false` when one already runs in this process. */
export const runDpdShipmentPassStep = createStep("dpd-shipment-pass-step", async (_input: RunDpdShipmentPassInput, { container }) => {
  const result: PassResult = await runShipmentPass(container)
  return new StepResponse(result)
})

export const runDpdShipmentPassWorkflow = createWorkflow("dpd-shipment-pass", (input: RunDpdShipmentPassInput) => {
  return new WorkflowResponse(runDpdShipmentPassStep(input))
})
