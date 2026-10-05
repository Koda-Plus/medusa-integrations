import type { MedusaContainer } from "@medusajs/framework/types"
import { CATALOG_SCHEDULE } from "../modules/baselinker/lib/constants"
import { canReadCatalog } from "../modules/baselinker/lib/options"
import { baselinkerService } from "../workflows/baselinker/runtime"
import { syncBaseLinkerCatalogWorkflow } from "../workflows/baselinker/sync-baselinker-catalog"

/**
 * CARDS AND EVERY PLAN, ONCE AN HOUR (at :15).
 *
 * One page of `getInventoryProductsList` is 1 000 cards, so an 11 000 card
 * catalog costs 13 requests an hour out of the 6 000 BaseLinker allows. The
 * plans of the directions in force (stock either way, the catalog import or
 * the card plan, the price push) come from the same read; only the catalog
 * import and the price push of net prices read product details on top, 100
 * cards per request.
 *
 * Quiet when there is nothing to do: `catalogSyncEnabled: false` or missing
 * options simply return. The workflow records every run.
 */
export default async function baselinkerSyncCatalogJob(container: MedusaContainer): Promise<void> {
  const svc = baselinkerService(container)
  const o = svc.getOptions()
  if (!o.catalogSyncEnabled || !canReadCatalog(o)) return
  await syncBaseLinkerCatalogWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "baselinker-sync-catalog",
  schedule: CATALOG_SCHEDULE,
}
