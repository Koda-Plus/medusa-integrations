import { COUNTER_MAX_AGE_SECONDS } from "../../modules/railway/lib/constants"
import { railwayCounters } from "../../modules/railway/lib/integration"
import { integrationEn, integrationPl } from "../../modules/railway/lib/integration-texts"
import { KIT_META } from "../../modules/railway/lib/kit-meta"
import { integrationRoutes, type MessageDraft } from "../../modules/railway/lib/kit-routes"
import { lastOverview, loadRailwayOverview } from "./reads"
import { railwayService } from "./runtime"

/**
 * koda.integration/1 for Railway: the manifest and the board counters.
 *
 *   GET /admin/railway/integration
 *   GET /admin/railway/integration/attention?scope=integration
 *
 * No entities: the hosting has no order, product or customer lines, so a
 * summary request answers 400 for every entity. The counters reuse the
 * overview the page read (up to 15 minutes old); without one they read it
 * once. Reads only, no write.
 */

const texts = { en: integrationEn, pl: integrationPl }

export const railwayIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: "/railway",
  entities: [],
  attention: ["integration"],
  widgets: [],
  texts,
  externalHosts: ["railway.com"],

  async status(ctx) {
    const svc = railwayService(ctx.scope)
    const o = svc.getOptions()
    const problems: MessageDraft[] = []
    if (o.demo) problems.push({ key: "integration.problem.demo" })
    else if (!o.token) problems.push({ key: "integration.problem.not_configured" })
    else if (svc.missingOptions().includes("projectId")) problems.push({ key: "integration.problem.project_id" })
    const last = lastOverview(ctx.scope)
    return {
      mode: o.demo ? "demo" : svc.isConfigured() ? "live" : "off",
      configured: svc.isConfigured(),
      lastSyncAt: last ? new Date(last.at).toISOString() : null,
      problems,
    }
  },

  async summarize() {
    return new Map()
  },

  async count(ctx, scopes) {
    const svc = railwayService(ctx.scope)
    if (!scopes.includes("integration") || !svc.isConfigured()) return []
    let last = lastOverview(ctx.scope)
    if (!last || Date.now() - last.at > COUNTER_MAX_AGE_SECONDS * 1000) {
      try {
        await loadRailwayOverview(ctx.scope)
      } catch {
        /* The counters stay quiet when Railway does not answer. */
      }
      last = lastOverview(ctx.scope)
    }
    return last ? railwayCounters(last.value.problems) : []
  },
})
