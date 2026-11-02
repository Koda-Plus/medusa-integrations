import type { MedusaContainer } from "@medusajs/framework/types"
import { runSync } from "../workflows/vonhalsky/sync"
import { optionsOf } from "../workflows/vonhalsky/runtime"

/**
 * THE SYNC, EVERY 5 MINUTES, whenever the plugin has a client (live,
 * sandbox or demo): marketplace commands and offer changes, price and stock
 * (when that setting is on), new and changed orders (imported only when
 * "Import automatically" is on), returns, claims and refunds, the category
 * tree once a week and a daily snapshot. Each part logs its own failure;
 * the job never throws.
 */
export default async function vonHalskySyncJob(container: MedusaContainer): Promise<void> {
  if (optionsOf(container).mode === "off") return
  await runSync(container).catch(() => undefined)
}

export const config = {
  name: "vonhalsky-sync",
  schedule: "*/5 * * * *",
}
