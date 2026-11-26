import { avatarsCounters } from "../../modules/avatars/lib/integration"
import { integrationEn, integrationPl } from "../../modules/avatars/lib/integration-texts"
import { KIT_META } from "../../modules/avatars/lib/kit-meta"
import { integrationRoutes, type MessageDraft } from "../../modules/avatars/lib/kit-routes"
import { canRender, consentOf } from "../../modules/avatars/lib/consent"
import { avatarsSvc } from "../../modules/avatars/lib/store"

/**
 * koda.integration/1 for AI Avatars: the manifest and the board counters.
 *
 *   GET /admin/avatars/integration
 *   GET /admin/avatars/integration/attention?scope=integration
 *
 * No entities: presentations have no order, product or customer lines, so a
 * summary request answers 400 for every entity. Reads only, no write, no
 * outside call.
 */
export const avatarsIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "module",
  adminPath: "/avatars",
  entities: [],
  attention: ["integration"],
  widgets: [],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const svc = avatarsSvc(ctx.scope)
    const c = svc.configured()
    const problems: MessageDraft[] = []
    if (svc.isDemo()) problems.push({ key: "integration.problem.demo" })
    else if (!c.tavus && !c.claude && !c.gemini) problems.push({ key: "integration.problem.not_configured" })
    else {
      if (!c.claude) problems.push({ key: "integration.problem.claude_missing" })
      if (!c.gemini) problems.push({ key: "integration.problem.gemini_missing" })
      if (!c.tavus) problems.push({ key: "integration.problem.tavus_missing" })
    }
    const configured = c.tavus && c.claude && c.gemini
    return {
      mode: svc.isDemo() ? "demo" : configured ? "live" : "off",
      configured,
      lastSyncAt: null,
      problems,
    }
  },

  async summarize() {
    return new Map()
  },

  async count(ctx, scopes) {
    if (!scopes.includes("integration")) return []
    const svc = avatarsSvc(ctx.scope)
    const [presentations, avatars] = await Promise.all([
      svc.listAvatarsPresentations({ state: ["review", "failed"] }, { take: 10_000, select: ["id", "state"] }),
      svc.listAvatarsAvatars({}, { take: 10_000 }),
    ])
    return avatarsCounters({
      review: presentations.filter((p) => p.state === "review").length,
      failed: presentations.filter((p) => p.state === "failed").length,
      withoutConsent: avatars.filter((a) => !canRender(consentOf(a))).length,
    })
  },
})
