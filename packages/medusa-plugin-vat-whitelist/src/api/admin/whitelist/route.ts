import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toCheck, toEntity, whitelistSvc } from "../../../modules/whitelist/lib/store"
import type { StatusResponse } from "../../../modules/whitelist/lib/contract"

/**
 * GET /admin/whitelist
 *
 * The whole status of the Whitelist page in one call: the counterparties,
 * the latest checks and the counters.
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
    counts: {
      entities: entityDtos.length,
      active: entityDtos.filter((e) => e.state === "active").length,
      exempt: entityDtos.filter((e) => e.state === "exempt").length,
      not_found: entityDtos.filter((e) => e.state === "not_found" || e.state === "invalid").length,
      checks: checks.length,
    },
    entities: entityDtos,
    checks: checks.map(toCheck),
  }

  res.json(status)
}
