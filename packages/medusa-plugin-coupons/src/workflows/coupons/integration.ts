import { EXPIRING_DAYS } from "../../modules/coupons/lib/constants"
import { toCouponDto } from "../../modules/coupons/lib/describe"
import { couponsCounters, customerSummary, orderSummary, productSummary } from "../../modules/coupons/lib/integration"
import { integrationEn, integrationPl } from "../../modules/coupons/lib/integration-texts"
import { KIT_META } from "../../modules/coupons/lib/kit-meta"
import { integrationRoutes, type SummaryDraft } from "../../modules/coupons/lib/kit-routes"
import { customerCoupons, orderCoupons, productCoupons, readPromotions } from "./reads"
import { couponsService } from "./runtime"

/**
 * koda.integration/1 for Coupons: the manifest, one line per order (the
 * coupons that worked), per customer (the codes they used) and per product
 * (active coupons that reach it), and the board counters.
 *
 *   GET /admin/coupons/integration
 *   GET /admin/coupons/integration/summary?entity=order&id=order_...
 *   GET /admin/coupons/integration/attention?scope=integration
 *
 * Reads only: nothing is written while answering.
 */
export const couponsIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "module",
  adminPath: "/coupons",
  entities: ["order", "customer", "product"],
  attention: ["integration"],
  widgets: [
    { id: "coupons.order", zone: "order.details" },
    { id: "coupons.customer", zone: "customer.details" },
    { id: "coupons.product", zone: "product.details" },
  ],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const o = couponsService(ctx.scope).getOptions()
    return {
      mode: "live",
      configured: true,
      lastSyncAt: null,
      problems: o.problems.length ? [{ key: "integration.problem.not_configured" }] : [],
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    const ids10 = ids.slice(0, 50)
    if (entity === "order") {
      for (const id of ids10) {
        const r = await orderCoupons(ctx.scope, id)
        const draft = orderSummary(id, r.applied.map((a) => ({ code: a.code, discount: a.discount })), (n) => ctx.money(n, r.currency || "PLN"))
        if (draft) out.set(id, draft)
      }
    } else if (entity === "customer") {
      for (const id of ids10) {
        const r = await customerCoupons(ctx.scope, id)
        const draft = customerSummary(id, { codes: r.used.length, discount: r.used.reduce((s, u) => s + u.discount, 0) }, (n) => ctx.money(n, r.currency || "PLN"))
        if (draft) out.set(id, draft)
      }
    } else if (entity === "product") {
      for (const id of ids10) {
        const r = await productCoupons(ctx.scope, id)
        const draft = productSummary(id, r.coupons.length)
        if (draft) out.set(id, draft)
      }
    }
    return out
  },

  async count(ctx) {
    const now = new Date()
    const soon = now.getTime() + EXPIRING_DAYS * 24 * 3600 * 1000
    const coupons = (await readPromotions(ctx.scope)).map((p) => toCouponDto(p, undefined, now))
    const active = coupons.filter((c) => c.status === "active")
    return couponsCounters({
      expiring: active.filter((c) => c.endsAt && new Date(c.endsAt).getTime() <= soon).length,
      automaticForEveryone: active.filter((c) => c.automatic && c.shape.groupIds.length === 0 && c.shape.customerIds.length === 0).length,
    })
  },
})
