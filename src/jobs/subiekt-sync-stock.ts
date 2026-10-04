import type { MedusaContainer } from "@medusajs/framework/types"
import { STOCK_SCHEDULE } from "../modules/subiekt/lib/constants"
import { subiektService } from "../workflows/subiekt/runtime"
import { runStockSync } from "../workflows/subiekt/sync-subiekt-stock"

/**
 * STOCK FROM SUBIEKT, EVERY 10 MINUTES. One page of 500 products is one
 * request to the bridge, and the bridge reads Sfera once per snapshot, so a
 * 5 000 product warehouse costs ten requests and one Sfera read.
 */
export default async function subiektSyncStockJob(container: MedusaContainer): Promise<void> {
  const svc = subiektService(container)
  const o = svc.getOptions()
  if (!o.stockSyncEnabled) return
  if (!o.demo && !svc.isConfigured()) return
  await runStockSync(container, "schedule")
}

export const config = {
  name: "subiekt-sync-stock",
  schedule: STOCK_SCHEDULE,
}
