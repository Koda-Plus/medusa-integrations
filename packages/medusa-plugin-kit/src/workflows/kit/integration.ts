import type { MedusaContainer } from "@medusajs/framework/types"
import { KIT_MODULE } from "../../modules/kit/lib/constants"
import { kitManifest } from "../../modules/kit/lib/integration"
import { effectiveSettings, readSettings } from "../../modules/kit/lib/store"

/**
 * The koda.integration/1 manifest of the plugin, for hosts that read every
 * plugin the same way.
 */
export async function kitManifestFor(container: MedusaContainer) {
  const svc = container.resolve(KIT_MODULE) as any
  const options = svc.getOptions()
  const settings = effectiveSettings(options, await readSettings({ resolve: (k) => container.resolve(k) }))
  return kitManifest(options, settings)
}
