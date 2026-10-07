import type { MedusaContainer } from "@medusajs/framework/types"
import { ALLEGRO_MODULE, DEMO_SEED_SCHEDULE } from "../modules/allegro/lib/constants"
import type AllegroModuleService from "../modules/allegro/service"
import { seedDemo } from "../workflows/allegro/demo-seed"

/**
 * DEMO DATA, EVERY MINUTE UNTIL IT IS THERE, DEMO MODE ONLY: the offer
 * snapshot, the order journal, the plans and the issues, once each kind that
 * never ran. Nothing to do once every kind has run (six small reads). The page
 * never builds them on a read.
 */
export default async function allegroDemoSeedJob(container: MedusaContainer): Promise<void> {
  const svc = container.resolve<AllegroModuleService>(ALLEGRO_MODULE)
  if (!svc.isDemo()) return
  await seedDemo(container)
}

export const config = {
  name: "allegro-demo-seed",
  schedule: DEMO_SEED_SCHEDULE,
}
