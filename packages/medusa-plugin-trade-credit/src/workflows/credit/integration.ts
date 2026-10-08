import { creditCounters, customerSummary, type LimitRow } from "../../modules/credit/lib/integration"
import { integrationEn, integrationPl } from "../../modules/credit/lib/integration-texts"
import { KIT_META } from "../../modules/credit/lib/kit-meta"
import { integrationRoutes, type SummaryDraft } from "../../modules/credit/lib/kit-routes"
import { creditSvc, num, str, toLimit } from "../../modules/credit/lib/store"

/**
 * koda.integration/1 for Trade Credit: the manifest, one line per customer
 * with credit terms, and the board counter of limits that need a look.
 *
 *   GET /admin/credit/integration
 *   GET /admin/credit/integration/summary?entity=customer&id=cus_...
 *   GET /admin/credit/integration/attention?scope=customers
 *
 * Reads only: nothing is written or recomputed while answering.
 */
export const creditIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "module",
  adminPath: "/credit",
  entities: ["customer"],
  attention: ["customers"],
  widgets: [],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const svc = creditSvc(ctx.scope)
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
    const svc = creditSvc(ctx.scope)
    const limits = await svc.listCreditLimits({ customer_id: ids }, { take: ids.length })
    const overdueRows = await svc.listCreditOrders({ customer_id: ids, state: "overdue" }, { take: ids.length * 20 })
    const overdueOf = new Map<string, number>()
    for (const r of overdueRows) {
      const cid = str(r.customer_id) ?? ""
      overdueOf.set(cid, (overdueOf.get(cid) ?? 0) + 1)
    }
    const money = (n: number) => ctx.money(n, "pln")
    for (const id of ids) {
      const row = limits.find((l) => str(l.customer_id) === id)
      if (!row) continue
      const dto = toLimit(row)
      const limit: LimitRow = { blocked: dto.blocked, exhausted: dto.exhausted, used_amount: num(dto.used_amount), limit_amount: num(dto.limit_amount), remaining_amount: num(dto.remaining_amount), net_days: dto.net_days }
      const draft = customerSummary(id, limit, overdueOf.get(id) ?? 0, money)
      if (draft) out.set(id, draft)
    }
    return out
  },

  async count(ctx) {
    const svc = creditSvc(ctx.scope)
    const limits = await svc.listCreditLimits({}, { take: 10_000 })
    const attention = limits.filter((l) => l.blocked === true || (num(l.limit_amount) > 0 && num(l.used_amount) >= num(l.limit_amount))).length
    return creditCounters({ attention })
  },
})
