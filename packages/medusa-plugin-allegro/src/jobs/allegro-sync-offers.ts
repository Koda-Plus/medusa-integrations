import type { MedusaContainer } from "@medusajs/framework/types"
import { ALLEGRO_MODULE, OFFERS_SCHEDULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { syncAllegroOffersWorkflow } from "../workflows/allegro/sync-allegro-offers"

/**
 * ALLEGRO OFFERS, ONCE AN HOUR (at :45).
 *
 * An hour, not five minutes: listing and ending offers is work done a few
 * times a day, so an hour of delay changes nothing, while five minutes would
 * mean twelve times more traffic for nothing. One run of a 5 000-offer
 * account is about six requests.
 *
 * Quiet when there is nothing to do: not configured, not connected or
 * `syncEnabled: false` simply returns. The workflow records every run, and
 * completes a device login the seller approved while nobody watched.
 */
export default async function allegroSyncOffersJob(container: MedusaContainer): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  const o = svc.getOptions()
  if (!o.syncEnabled) return
  if (!o.demo && !svc.isConfigured()) return
  await syncAllegroOffersWorkflow(container).run({ input: { trigger: "schedule" } })
}

export const config = {
  name: "allegro-sync-offers",
  schedule: OFFERS_SCHEDULE,
}
