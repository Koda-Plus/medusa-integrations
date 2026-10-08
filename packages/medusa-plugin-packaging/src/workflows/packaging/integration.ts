import { packagingCounters, productSummary, type PackagingRow } from "../../modules/packaging/lib/integration"
import { integrationEn, integrationPl } from "../../modules/packaging/lib/integration-texts"
import { KIT_META } from "../../modules/packaging/lib/kit-meta"
import { integrationRoutes, type SummaryDraft } from "../../modules/packaging/lib/kit-routes"
import { num, packagingSvc, str } from "../../modules/packaging/lib/store"

/**
 * koda.integration/1 for Packaging: the manifest, one line per product with
 * its ladder, and the board counter of products without one.
 *
 *   GET /admin/packaging/integration
 *   GET /admin/packaging/integration/summary?entity=product&id=prod_...
 *   GET /admin/packaging/integration/attention?scope=products
 *
 * Reads only: nothing is written while answering.
 */
export const packagingIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "module",
  adminPath: "/packaging",
  entities: ["product"],
  attention: ["products"],
  widgets: [],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const svc = packagingSvc(ctx.scope)
    return {
      mode: svc.isDemo() ? "demo" : "live",
      configured: true,
      lastSyncAt: null,
      problems: [],
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    if (entity !== "product") return out
    const svc = packagingSvc(ctx.scope)
    const records = await svc.listPackagingProducts({ product_id: ids }, { take: ids.length * 2 })
    const units = await svc.listPackagingUnits({ product_id: ids }, { take: ids.length * 10 })
    const byProduct = new Map<string, PackagingRow>()
    for (const r of records) {
      byProduct.set(str(r.product_id) ?? "", {
        moq: num(r.moq),
        step: num(r.step),
        units: units.filter((u) => str(u.product_id) === str(r.product_id)).map((u) => ({ name: str(u.name) ?? "szt.", pieces: num(u.pieces) })),
      })
    }
    for (const id of ids) {
      const draft = productSummary(id, byProduct.get(id))
      if (draft) out.set(id, draft)
    }
    return out
  },

  async count(ctx) {
    const svc = packagingSvc(ctx.scope)
    const records = await svc.listPackagingProducts({}, { take: 10_000 })
    const units = await svc.listPackagingUnits({}, { take: 10_000 })
    const withUnits = new Set(units.map((u) => str(u.product_id)))
    const without = records.filter((r) => !withUnits.has(str(r.product_id))).length
    return packagingCounters({ without })
  },
})
