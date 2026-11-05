import type { MedusaContainer } from "@medusajs/framework/types"
import { SYNC_SCHEDULE } from "../modules/dpd/lib/constants"
import { runShipmentPass } from "../workflows/dpd/resolve"

/**
 * THE SHIPMENT PASS, every 5 minutes: old documents removed, leases that ran
 * out taken back, unclear shipments looked up in DPD (with the shipment
 * writer armed), and with autoCreate the new shipments created and the
 * labels that did not come asked for again. Only rows recorded after the
 * writer was armed and within autoCreateMaxAgeHours: no backlog goes out by
 * itself. Waits while DPD is not configured; one pass at a time per process.
 */
export default async function dpdSyncShipments(container: MedusaContainer): Promise<void> {
  await runShipmentPass(container)
}

export const config = {
  name: "dpd-sync-shipments",
  schedule: SYNC_SCHEDULE,
}
