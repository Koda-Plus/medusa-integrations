import { orderSummary, productSummary, vonHalskyCounters, type OrderRow, type ProductOfferRow } from "../../modules/vonhalsky/lib/integration"
import { integrationEn, integrationPl } from "../../modules/vonhalsky/lib/integration-texts"
import { KIT_META } from "../../modules/vonhalsky/lib/kit-meta"
import { integrationRoutes, type SummaryDraft } from "../../modules/vonhalsky/lib/kit-routes"
import { vonHalskySvc } from "../../modules/vonhalsky/lib/store"

/**
 * koda.integration/1 for InPost Von Halsky: the manifest, one line per
 * Medusa order imported from the marketplace and per product with offers,
 * and the board counters.
 *
 *   GET /admin/vonhalsky/integration
 *   GET /admin/vonhalsky/integration/summary?entity=order&id=order_...  (or entity=product)
 *   GET /admin/vonhalsky/integration/attention?scope=orders,products
 *
 * Reads only: nothing is written and nothing is asked of the marketplace while answering.
 */
export const vonHalskyIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: "/vonhalsky",
  entities: ["order", "product"],
  attention: ["orders", "products"],
  widgets: [{ id: "vonhalsky.order", zone: "order.details" }],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const svc = vonHalskySvc(ctx.scope)
    const o = svc.getOptions()
    let lastSyncAt: Date | null = null
    try {
      const [newest] = await svc.listVonHalskySyncLogs({}, { take: 1, order: { created_at: "DESC" }, select: ["id", "created_at"] })
      lastSyncAt = newest?.created_at ? new Date(newest.created_at) : null
    } catch {
      lastSyncAt = null
    }
    const problems = o.mode === "off" ? [{ key: "integration.problems.credentials" }] : o.mode === "live" || o.mode === "sandbox" ? [{ key: "integration.problems.pending" }] : []
    return {
      mode: o.mode,
      configured: o.mode !== "off",
      writers: { armed: o.sendTracking ? 1 : 0, total: 1 },
      lastSyncAt,
      problems,
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    const svc = vonHalskySvc(ctx.scope)
    if (entity === "order") {
      const rows = (await svc.listVonHalskyOrders({ order_id: ids }, { take: ids.length * 2 })) as Array<Record<string, any>>
      for (const r of rows) {
        if (!r.order_id || r.status !== "imported") continue
        const row: OrderRow = {
          order_id: String(r.order_id),
          marketplace_order_id: String(r.marketplace_order_id),
          demo: r.demo === true,
          delivery_type: r.delivery_type ?? null,
          delivery_point: r.delivery_point ?? null,
          payment_type: r.payment_type ?? null,
          tracking_status: String(r.tracking_status ?? "none"),
          tracking_numbers: Array.isArray(r.tracking_numbers) ? r.tracking_numbers.map(String) : [],
          updated_at: r.updated_at ?? null,
        }
        const draft = orderSummary(row)
        if (draft) out.set(row.order_id, draft)
      }
      return out
    }
    if (entity === "product") {
      const rows = (await svc.listVonHalskyOffers({ product_id: ids }, { take: 2000 })) as Array<Record<string, any>>
      const byProduct = new Map<string, ProductOfferRow[]>()
      for (const r of rows) {
        const list = byProduct.get(String(r.product_id)) ?? []
        list.push({ product_id: String(r.product_id), status: String(r.status), reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : [], demo: r.demo === true, updated_at: r.updated_at ?? null })
        byProduct.set(String(r.product_id), list)
      }
      for (const [productId, list] of byProduct) {
        const draft = productSummary(productId, list)
        if (draft) out.set(productId, draft)
      }
    }
    return out
  },

  async count(ctx) {
    const svc = vonHalskySvc(ctx.scope)
    const [, held] = await svc.listAndCountVonHalskyOrders({ status: "held" }, { take: 1 })
    const [, trackingFailed] = await svc.listAndCountVonHalskyOrders({ tracking_status: "failed" }, { take: 1 })
    const [, awaitingShipment] = await svc.listAndCountVonHalskyOrders({ status: "imported", tracking_status: ["none", "pending_api"] }, { take: 1 })
    const [, blockedOffers] = await svc.listAndCountVonHalskyOffers({ status: "blocked" }, { take: 1 })
    return vonHalskyCounters({ held, trackingFailed, awaitingShipment, blockedOffers })
  },
})
