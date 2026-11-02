import type { MedusaContainer } from "@medusajs/framework/types"
import { readSettings } from "../modules/vonhalsky/lib/store"
import { importNewOrders } from "../workflows/vonhalsky/orders"
import { clientOf, optionsOf } from "../workflows/vonhalsky/runtime"

/**
 * ORDER IMPORT, EVERY 15 MINUTES, only when a person switched "Import
 * automatically" on (Settings, Orders) and the seller API client is
 * available. In this version the live client is pending, so the job does
 * nothing in sandbox and live; demo has no marketplace buyers of its own
 * (orders come from "Simulate an order"). Never throws.
 */
export default async function vonHalskyImportOrdersJob(container: MedusaContainer): Promise<void> {
  const o = optionsOf(container)
  if (o.mode === "off" || o.demo) return
  const client = clientOf(container)
  if (!client?.available) return
  const settings = await readSettings(container)
  if (!settings.orders.autoImport) return
  await importNewOrders(container).catch(() => undefined)
}

export const config = {
  name: "vonhalsky-import-orders",
  schedule: "*/15 * * * *",
}
