import { customerSummary, whitelistCounters, type EntityRow } from "../../modules/whitelist/lib/integration"
import { integrationEn, integrationPl } from "../../modules/whitelist/lib/integration-texts"
import { KIT_META } from "../../modules/whitelist/lib/kit-meta"
import { integrationRoutes, type SummaryDraft } from "../../modules/whitelist/lib/kit-routes"
import { str, whitelistSvc } from "../../modules/whitelist/lib/store"

/**
 * koda.integration/1 for the VAT Whitelist: the manifest, one line per
 * customer whose company was checked, and the board counter of linked
 * counterparties that need a look.
 *
 *   GET /admin/whitelist/integration
 *   GET /admin/whitelist/integration/summary?entity=customer&id=cus_...
 *   GET /admin/whitelist/integration/attention?scope=customers
 *
 * Reads only: nothing is checked, written or sent while answering.
 */
export const whitelistIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: "/whitelist",
  entities: ["customer"],
  attention: ["customers"],
  widgets: [],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const svc = whitelistSvc(ctx.scope)
    return {
      mode: svc.isDemo() ? "demo" : "live",
      configured: true,
      lastSyncAt: null,
      problems: [],
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    if (entity !== "customer") return out
    const svc = whitelistSvc(ctx.scope)
    const rows = await svc.listWhitelistEntities({ customer_id: ids }, { take: ids.length * 2 })
    const byCustomer = new Map<string, EntityRow>()
    for (const r of rows) {
      const cid = str(r.customer_id)
      if (cid) byCustomer.set(cid, { id: r.id, nip: str(r.nip) ?? "", state: str(r.state) ?? "unavailable", name: str(r.name), customer_id: cid })
    }
    for (const id of ids) {
      const draft = customerSummary(id, byCustomer.get(id))
      if (draft) out.set(id, draft)
    }
    return out
  },

  async count(ctx) {
    const svc = whitelistSvc(ctx.scope)
    const rows = await svc.listWhitelistEntities({ state: ["exempt", "not_found", "invalid", "unavailable"] }, { take: 10_000 })
    const linked = rows.filter((r) => str(r.customer_id))
    return whitelistCounters({ unverified: linked.length })
  },
})
