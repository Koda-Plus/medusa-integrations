import { inpostPayCounters, orderSummary, type OrderRow } from "../../modules/inpostpay/lib/integration"
import { integrationEn, integrationPl } from "../../modules/inpostpay/lib/integration-texts"
import { KIT_META } from "../../modules/inpostpay/lib/kit-meta"
import { integrationRoutes, type SummaryDraft } from "../../modules/inpostpay/lib/kit-routes"
import { inpostPaySvc, PAYMENT_PROBLEMS } from "../../modules/inpostpay/lib/store"

/**
 * koda.integration/1 for InPost Pay: the manifest, one line per order that
 * came through InPost Pay, and the board counters.
 *
 *   GET /admin/inpostpay/integration
 *   GET /admin/inpostpay/integration/summary?entity=order&id=order_...
 *   GET /admin/inpostpay/integration/attention?scope=orders
 *
 * Reads only: nothing is written and nothing is asked of InPost while answering.
 */
export const inpostPayIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: "/inpostpay",
  entities: ["order"],
  attention: ["orders"],
  widgets: [{ id: "inpostpay.order", zone: "order.details" }],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const svc = inpostPaySvc(ctx.scope)
    const o = svc.getOptions()
    return {
      mode: o.mode,
      configured: o.mode !== "off",
      writers: { armed: o.sendOrderEvents ? 1 : 0, total: 1 },
      lastSyncAt: null,
      problems: o.mode === "off" ? [{ key: "integration.problems.keys" }] : [],
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    if (entity !== "order") return out
    const rows = (await inpostPaySvc(ctx.scope).listInpostPayBaskets({ order_id: ids }, { take: ids.length * 2 })) as Array<Record<string, any>>
    for (const r of rows) {
      const row: OrderRow = {
        order_id: String(r.order_id),
        demo: r.demo === true,
        status: String(r.status),
        payment_status: r.payment_status ?? null,
        order_status: r.order_status ?? null,
        delivery_type: r.delivery_type ?? null,
        delivery_point: r.delivery_point ?? null,
        masked_phone: r.masked_phone ?? null,
        updated_at: r.updated_at ?? null,
      }
      const draft = orderSummary(row)
      if (draft) out.set(row.order_id, draft)
    }
    return out
  },

  async count(ctx) {
    const svc = inpostPaySvc(ctx.scope)
    const [, paymentProblems] = await svc.listAndCountInpostPayBaskets({ payment_status: [...PAYMENT_PROBLEMS] }, { take: 1 })
    const [, failedBaskets] = await svc.listAndCountInpostPayBaskets({ status: "failed" }, { take: 1 })
    return inpostPayCounters({ paymentProblems, failedBaskets })
  },
})
