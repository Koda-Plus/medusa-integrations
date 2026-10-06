import type { MedusaContainer } from "@medusajs/framework/types"
import { EXPIRE_SCHEDULE } from "../modules/negotiations/lib/constants"
import { expireNegotiations } from "../workflows/negotiations/expire"

/**
 * STALE THREADS EXPIRE, EVERY HOUR AT MINUTE 15.
 *
 * Active threads (open or counter offered) whose counter offer ran out, or
 * where nobody moved for `expiryDays`, become `expired` with a system
 * message and `negotiation.expired`. Live threads only; `expiryDays: 0`
 * leaves only offers with their own validity to expire.
 */
export default async function negotiationsExpireJob(container: MedusaContainer): Promise<void> {
  await expireNegotiations(container, "schedule")
}

export const config = {
  name: "negotiations-expire",
  schedule: EXPIRE_SCHEDULE,
}
