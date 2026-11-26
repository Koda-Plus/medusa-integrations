import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { writerDtos } from "../../../workflows/ceneo/import-orders"
import { BUILD_FIELDS, buildStatus, categoryStats, ceneoSvc, countOffers, orderStats, reviewStats } from "../../../modules/ceneo/lib/store"

/**
 * GET /admin/ceneo
 *
 * The whole status of the Ceneo page in one call: what the feed still
 * needs, the newest builds, the offer counters and how the Ceneo API
 * answers, and the writers. The API key never leaves the server, only whether one is set.
 * The feed token does: the merchant pastes the feed address into Panel
 * Ceneo, and only admins read this route.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = ceneoSvc(req.scope)
  const config = { take: 1, order: { built_at: "DESC" }, select: BUILD_FIELDS }
  const [[lastBuilt], [newest], counts, categories, reviews, orders, writers] = await Promise.all([svc.listCeneoFeeds({ status: "built" }, config), svc.listCeneoFeeds({}, config), countOffers(svc), categoryStats(svc), reviewStats(svc), orderStats(svc), writerDtos(svc)])
  res.json(buildStatus(svc.getOptions(), lastBuilt ?? null, newest ?? null, counts, categories, reviews, orders, writers))
}
