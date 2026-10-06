import type { MedusaContainer } from "@medusajs/framework/types"
import { HOUSEKEEPING_SCHEDULE } from "../modules/emails/lib/constants"
import { runHousekeeping } from "../workflows/emails/housekeeping"

/**
 * Every hour at :50: messages stuck mid-send become "unknown", the send log
 * keeps `logRetentionDays`, the simulated outbox two weeks, and in demo mode
 * a stale seed of the outbox is rebuilt with fresh dates. Never throws.
 */
export default async function emailsHousekeeping(container: MedusaContainer): Promise<void> {
  try {
    await runHousekeeping(container)
  } catch {
    /* logged inside */
  }
}

export const config = {
  name: "emails-housekeeping",
  schedule: HOUSEKEEPING_SCHEDULE,
}
