import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { testRegistry } from "../../../../../modules/whitelist/lib/check"
import { PL_REGISTRIES, type PlRegistry } from "../../../../../modules/whitelist/lib/options"
import { whitelistSvc } from "../../../../../modules/whitelist/lib/store"
import type { RegistryTestResponse } from "../../../../../modules/whitelist/lib/contract"
import { bodyOf, fail } from "../../../../whitelist/helpers"

/**
 * POST /admin/whitelist/registries/ping
 *
 * The connection test of the settings: GUS logs in with the key, reads the
 * session status and logs out (no lookup is spent), VIES reads its status
 * page, the whitelist answers its API root. Body: { registry }. Nothing is
 * saved, so the demo account may run it too.
 *
 * NO "test" ANYWHERE IN THE PATH: `medusa build` and `medusa plugin:build`
 * drop every file whose path contains the text "test" (a substring match),
 * so such a route works in `medusa develop` and is missing from the
 * production build.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = bodyOf(req)
  const registry = typeof body.registry === "string" ? body.registry : ""
  if (!(PL_REGISTRIES as readonly string[]).includes(registry)) {
    fail(res, 400, "registry_invalid", "Choose gus, whitelist or vies.")
    return
  }
  const options = whitelistSvc(req.scope).getOptions()
  const r = await testRegistry(registry as PlRegistry, options)
  const out: RegistryTestResponse = { registry: registry as PlRegistry, ...r }
  res.json(out)
}
