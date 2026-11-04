import type { MedusaContainer } from "@medusajs/framework/types"
import { STATUS_SCHEDULE } from "../modules/dpd/lib/constants"
import { runStatusPass } from "../workflows/dpd/statuses"

/**
 * THE STATUS PASS, every 5 minutes, 2 minutes after the shipment pass:
 * due shipments claimed in the database (one row per process), each
 * waybill asked from InfoServices (live) or from the status simulator
 * (demo, sandbox), the events stored once, the stage folded, the Medusa
 * fulfillment marked shipped or delivered when that writer is armed, old
 * status events pruned once a day. Independent of the DPDServices
 * credentials and of the shipment writer; one pass at a time per process.
 */
export default async function dpdSyncStatuses(container: MedusaContainer): Promise<void> {
  await runStatusPass(container)
}

export const config = { name: "dpd-sync-statuses", schedule: STATUS_SCHEDULE }
