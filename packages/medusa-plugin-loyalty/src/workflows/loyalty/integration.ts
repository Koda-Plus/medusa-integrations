import { customerSummary, loyaltyCounters, type AccountRow } from "../../modules/loyalty/lib/integration"
import { integrationEn, integrationPl } from "../../modules/loyalty/lib/integration-texts"
import { KIT_META } from "../../modules/loyalty/lib/kit-meta"
import { integrationRoutes, type SummaryDraft } from "../../modules/loyalty/lib/kit-routes"
import { loyaltySvc, num, str } from "../../modules/loyalty/lib/store"

/**
 * koda.integration/1 for Loyalty: the manifest, one line per customer with
 * a points account, and the board counter of accounts ready for a reward.
 *
 *   GET /admin/loyalty/integration
 *   GET /admin/loyalty/integration/summary?entity=customer&id=cus_...
 *   GET /admin/loyalty/integration/attention?scope=customers
 *
 * Reads only: nothing is written while answering.
 */
export const loyaltyIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "module",
  adminPath: "/loyalty",
  entities: ["customer"],
  attention: ["customers"],
  widgets: [],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const svc = loyaltySvc(ctx.scope)
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
    const svc = loyaltySvc(ctx.scope)
    const options = svc.getOptions()
    const rows = await svc.listLoyaltyAccounts({ customer_id: ids }, { take: ids.length })
    const firstReward = options.rewards[0]?.at ?? Number.POSITIVE_INFINITY
    const byCustomer = new Map<string, AccountRow>()
    for (const r of rows) {
      const cid = str(r.customer_id)
      if (cid) byCustomer.set(cid, { balance: num(r.balance), total_earned: num(r.total_earned), first_reward_at: firstReward })
    }
    for (const id of ids) {
      const draft = customerSummary(id, byCustomer.get(id), (n) => ctx.money(n, "pln"))
      if (draft) out.set(id, draft)
    }
    return out
  },

  async count(ctx) {
    const svc = loyaltySvc(ctx.scope)
    const options = svc.getOptions()
    const firstReward = options.rewards[0]?.at ?? Number.POSITIVE_INFINITY
    const rows = await svc.listLoyaltyAccounts({}, { take: 10_000 })
    const ready = rows.filter((r) => num(r.balance) >= firstReward).length
    return loyaltyCounters({ ready })
  },
})
