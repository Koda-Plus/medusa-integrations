import type { MedusaContainer } from "@medusajs/framework/types"
import { capturePrices } from "../modules/compliance/lib/prices"

/**
 * THE OMNIBUS PRICE HISTORY: snapshots the base prices of the catalog once a
 * day, so the "lowest price of the last 30 days" keeps a rolling history that
 * Medusa itself does not store. Runs at 03:20 every day; the seed captures the
 * first snapshot at boot and the panel has a "Capture now" action.
 */
export default async function compliancePriceSnapshotJob(container: MedusaContainer): Promise<void> {
  try {
    const count = await capturePrices(container)
    if (count > 0) console.info(`[compliance] price snapshot: ${count} rows`)
  } catch (err) {
    console.warn(`[compliance] price snapshot failed: ${(err as Error).message}`)
  }
}

export const config = {
  name: "compliance-price-snapshot",
  schedule: "20 3 * * *",
}
