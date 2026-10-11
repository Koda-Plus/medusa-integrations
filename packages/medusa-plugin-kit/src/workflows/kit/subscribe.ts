import type { MedusaContainer } from "@medusajs/framework/types"
import { KIT_MODULE } from "../../modules/kit/lib/constants"
import { createKitClient } from "../../modules/kit/lib/client"
import type { ResolvedKitOptions } from "../../modules/kit/lib/options"
import { subscribeToKit, type SubscribeInput } from "../../modules/kit/lib/subscribe"
import { effectiveSettings, readSettings } from "../../modules/kit/lib/store"

/**
 * One sign-up into Kit, exported for custom code: the upsert with the tags
 * and the double opt-in form in effect, one log row per attempt. Used by the
 * store route.
 */
export async function subscribeViaKit(container: MedusaContainer, input: SubscribeInput) {
  const svc = container.resolve(KIT_MODULE) as any
  const logger = svc.getLogger()
  const options = svc.getOptions() as ResolvedKitOptions
  const settings = effectiveSettings(options, await readSettings({ resolve: (k) => container.resolve(k) }))
  const client = createKitClient(options, logger)
  return await subscribeToKit({ scope: { resolve: (k) => container.resolve(k) }, options, settings, client, input })
}
