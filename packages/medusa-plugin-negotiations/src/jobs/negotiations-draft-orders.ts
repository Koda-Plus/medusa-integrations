import type { MedusaContainer } from "@medusajs/framework/types"
import { DRAFT_ORDERS_SCHEDULE } from "../modules/negotiations/lib/constants"
import { runDraftOrders, writerStates } from "../workflows/negotiations/draft-orders"

/**
 * THE DRAFT ORDER WRITER, EVERY 10 MINUTES, ONLY WHEN ARMED.
 *
 * Accepted threads queued while the writer was armed (or by a person)
 * become Medusa draft orders, at most `draftOrders.maxPerRun` per run. Off
 * by default: it needs `writers.draftOrders: true` in the options and a
 * person arming it in Settings.
 */
export default async function negotiationsDraftOrdersJob(container: MedusaContainer): Promise<void> {
  const writer = (await writerStates(container)).draftOrders
  if (!writer.armed) return
  await runDraftOrders(container, { dryRun: false, trigger: "schedule" })
}

export const config = {
  name: "negotiations-draft-orders",
  schedule: DRAFT_ORDERS_SCHEDULE,
}
