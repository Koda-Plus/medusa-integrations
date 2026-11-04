import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toCheck, toEntity, whitelistSvc } from "../../../modules/whitelist/lib/store"
import { gusKey, registryMode } from "../../../modules/whitelist/lib/options"
import type { StatusResponse } from "../../../modules/whitelist/lib/contract"

/**
 * GET /admin/whitelist
 *
 * The whole status of the Whitelist page in one call: the counterparties,
 * the latest checks, the counters and how each registry answers. The GUS
 * key itself never leaves the server, only whether one is set.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = whitelistSvc(req.scope)
  const options = svc.getOptions()
  const [entities, checks] = await Promise.all([
    svc.listWhitelistEntities({}, { take: 500, order: { checked_at: "DESC" } }),
    svc.listWhitelistChecks({}, { take: 50, order: { created_at: "DESC" } }),
  ])
  const entityDtos = entities.map((r) => toEntity(r, options.staleHours))

  const status: StatusResponse = {
    demo: options.demo,
    staleHours: options.staleHours,
    registries: {
      pl: options.plRegistries,
      gus: { mode: registryMode(options, "gus"), environment: options.gusEnvironment, key: Boolean(gusKey(options)) },
      whitelist: { mode: registryMode(options, "whitelist"), baseUrl: options.baseUrl },
      vies: { mode: registryMode(options, "vies") },
      live: options.live,
      timeoutMs: options.timeoutMs,
    },
    counts: {
      entities: entityDtos.length,
      active: entityDtos.filter((e) => e.state === "active").length,
      exempt: entityDtos.filter((e) => e.state === "exempt").length,
      inactive: entityDtos.filter((e) => e.state === "inactive").length,
      not_found: entityDtos.filter((e) => e.state === "not_found" || e.state === "invalid" || e.state === "inactive").length,
      checks: checks.length,
    },
    entities: entityDtos,
    checks: checks.map(toCheck),
  }

  res.json(status)
}
