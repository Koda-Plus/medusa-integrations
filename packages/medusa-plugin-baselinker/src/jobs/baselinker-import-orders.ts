import type { MedusaContainer } from "@medusajs/framework/types"
import { IMPORT_SCHEDULE } from "../modules/baselinker/lib/constants"
import { canImportOrders } from "../modules/baselinker/lib/options"
import { importRules, runOrderImport } from "../workflows/baselinker/order-import"
import { baselinkerService } from "../workflows/baselinker/runtime"

/**
 * MARKETPLACE ORDERS FROM BASELINKER, EVERY 5 MINUTES.
 *
 * One `getOrders` page (100 orders) usually covers five minutes of a busy
 * account. New orders of the chosen sources become `pending` rows the admin
 * shows; only while the `orderImport` writer is armed are they turned into
 * Medusa orders, exactly once each. Quiet when nothing happened.
 */
export default async function baselinkerImportOrdersJob(container: MedusaContainer): Promise<void> {
  const svc = baselinkerService(container)
  const o = svc.getOptions()
  if (!canImportOrders(o) || importRules(o).length === 0) return
  await runOrderImport(container, "schedule")
}

export const config = {
  name: "baselinker-import-orders",
  schedule: IMPORT_SCHEDULE,
}
