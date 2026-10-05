import type { MedusaContainer } from "@medusajs/framework/types"
import { PRODUCTS_SCHEDULE } from "../modules/subiekt/lib/constants"
import { subiektService } from "../workflows/subiekt/runtime"
import { runProductSync } from "../workflows/subiekt/sync-subiekt-products"

/**
 * PRODUCTS AND PRICES FROM SUBIEKT, ONCE AN HOUR: reads the bridge product
 * list, stores the plan for the admin and applies it only through the writers
 * a person armed (prices, new products). Read only until then.
 */
export default async function subiektSyncProductsJob(container: MedusaContainer): Promise<void> {
  const svc = subiektService(container)
  const o = svc.getOptions()
  if (!o.productSyncEnabled) return
  if (!o.demo && !svc.isConfigured()) return
  await runProductSync(container, "schedule")
}

export const config = {
  name: "subiekt-sync-products",
  schedule: PRODUCTS_SCHEDULE,
}
