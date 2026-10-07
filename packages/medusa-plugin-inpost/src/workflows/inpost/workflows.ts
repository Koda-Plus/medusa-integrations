import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import type { ParcelRow } from "../../modules/inpost/lib/dto"
import { createShipment, recordFulfillment, refreshParcel } from "./parcels"
import { runSync, type SyncStats } from "./sync"

/**
 * The flows as Medusa workflows, for your own code:
 *
 *   import { syncInpostShipmentsWorkflow } from "@koda-plus/medusa-plugin-inpost/workflows"
 *   await syncInpostShipmentsWorkflow(container).run({ input: { trigger: "manual" } })
 *
 * They follow the same rules as the admin: creating a shipment needs the
 * shipment writer allowed in the options and armed in Settings.
 */

export interface SyncInpostInput {
  trigger: "schedule" | "manual"
}

/** The status pass. `null` when one already runs in this process. */
export const syncInpostShipmentsStep = createStep("inpost-sync-shipments-step", async (input: SyncInpostInput, { container }) => {
  const stats: SyncStats | null = await runSync(container, input.trigger)
  return new StepResponse(stats)
})

export const syncInpostShipmentsWorkflow = createWorkflow("inpost-sync-shipments", (input: SyncInpostInput) => {
  return new WorkflowResponse(syncInpostShipmentsStep(input))
})

export interface CreateInpostShipmentInput {
  /** The `inpost_parcel` row (`inpar_...`). */
  parcelId: string
  /** The hash of the plan a person read; leave it out only for automated runs. */
  planHash?: string | null
  /** Who asks: an admin user id, or "system". */
  actor?: string | null
}

/** Creates the ShipX shipment of a pending row, exactly once. Throws when the writer is not armed or the plan has problems. */
export const createInpostShipmentStep = createStep("inpost-create-shipment-step", async (input: CreateInpostShipmentInput, { container }) => {
  const row: ParcelRow = await createShipment(container, input.parcelId, {
    planHash: input.planHash ?? null,
    actor: input.actor ?? "system",
    trigger: input.planHash ? "manual" : "auto",
  })
  return new StepResponse(row)
})

export const createInpostShipmentWorkflow = createWorkflow("inpost-create-shipment", (input: CreateInpostShipmentInput) => {
  return new WorkflowResponse(createInpostShipmentStep(input))
})

export interface RefreshInpostShipmentInput {
  parcelId: string
}

/** Reads one shipment from ShipX again and applies its status (events, follow ups). */
export const refreshInpostShipmentStep = createStep("inpost-refresh-shipment-step", async (input: RefreshInpostShipmentInput, { container }) => {
  const row: ParcelRow = await refreshParcel(container, input.parcelId, "admin")
  return new StepResponse(row)
})

export const refreshInpostShipmentWorkflow = createWorkflow("inpost-refresh-shipment", (input: RefreshInpostShipmentInput) => {
  return new WorkflowResponse(refreshInpostShipmentStep(input))
})

export interface RecordInpostFulfillmentInput {
  orderId: string
  fulfillmentId: string
}

/** Records the InPost row of a fulfillment (what the subscriber of order.fulfillment_created does). */
export const recordInpostFulfillmentStep = createStep("inpost-record-fulfillment-step", async (input: RecordInpostFulfillmentInput, { container }) => {
  const row: ParcelRow | null = await recordFulfillment(container, input.orderId, input.fulfillmentId)
  return new StepResponse(row)
})

export const recordInpostFulfillmentWorkflow = createWorkflow("inpost-record-fulfillment", (input: RecordInpostFulfillmentInput) => {
  return new WorkflowResponse(recordInpostFulfillmentStep(input))
})
