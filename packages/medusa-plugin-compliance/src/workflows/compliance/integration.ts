import { complianceCounters, customerSummary, productSummary, type DsrRow, type ProductRecord } from "../../modules/compliance/lib/integration"
import { integrationEn, integrationPl } from "../../modules/compliance/lib/integration-texts"
import { KIT_META } from "../../modules/compliance/lib/kit-meta"
import { integrationRoutes, type SummaryDraft } from "../../modules/compliance/lib/kit-routes"
import { complianceSvc, str } from "../../modules/compliance/lib/store"

/**
 * koda.integration/1 for EU Compliance: the manifest, one line per product
 * with its GPSR record and per customer with data requests, and the board
 * counters (products with an incomplete record, open data requests).
 *
 *   GET /admin/compliance/integration
 *   GET /admin/compliance/integration/summary?entity=product&id=prod_...
 *   GET /admin/compliance/integration/attention?scope=products,customers
 *
 * Reads only: nothing is written, seeded or sent while answering.
 */
export const complianceIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "module",
  adminPath: "/compliance",
  entities: ["product", "customer"],
  attention: ["products", "customers"],
  widgets: [],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const svc = complianceSvc(ctx.scope)
    return {
      mode: svc.isDemo() ? "demo" : "live",
      configured: true,
      lastSyncAt: null,
      problems: [],
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    const svc = complianceSvc(ctx.scope)
    if (entity === "product") {
      const rows = await svc.listComplianceProducts({ product_id: ids }, { take: ids.length * 2 })
      const byId = new Map(rows.map((r) => [str(r.product_id) ?? "", r]))
      /* The names of the operators, read once for every record the batch touches. */
      const operatorIds = new Set<string>()
      for (const r of rows) {
        for (const id of [str(r.manufacturer_id), str(r.responsible_person_id)]) if (id) operatorIds.add(id)
      }
      const persons = operatorIds.size > 0 ? await svc.listComplianceOperators({ id: [...operatorIds] }, { take: operatorIds.size }) : []
      const nameOf = new Map(persons.map((p) => [p.id, str(p.name)]))
      for (const id of ids) {
        const row = byId.get(id)
        const record: ProductRecord | undefined = row
          ? {
              product_id: id,
              complete: row.complete === true,
              manufacturer_id: str(row.manufacturer_id),
              responsible_person_id: str(row.responsible_person_id),
            }
          : undefined
        const names = {
          manufacturer: row ? (str(row.manufacturer_id) ? (nameOf.get(str(row.manufacturer_id)!) ?? null) : null) : null,
          responsible: row ? (str(row.responsible_person_id) ? (nameOf.get(str(row.responsible_person_id)!) ?? null) : null) : null,
        }
        const draft = productSummary(id, record, names)
        if (draft) out.set(id, draft)
      }
      return out
    }
    if (entity === "customer") {
      const rows = await svc.listComplianceDsrs({ customer_id: ids }, { take: ids.length * 20 })
      const byCustomer = new Map<string, DsrRow[]>()
      for (const r of rows) {
        const cid = str(r.customer_id) ?? ""
        const list = byCustomer.get(cid) ?? []
        list.push({ customer_id: cid, type: str(r.type) ?? "access", status: str(r.status) ?? "pending", created_at: (r.created_at as string | Date | null) ?? null })
        byCustomer.set(cid, list)
      }
      for (const id of ids) {
        const draft = customerSummary(id, byCustomer.get(id) ?? [])
        if (draft) out.set(id, draft)
      }
      return out
    }
    return out
  },

  async count(ctx) {
    const svc = complianceSvc(ctx.scope)
    const [products, dsr] = await Promise.all([
      svc.listComplianceProducts({ complete: false }, { take: 10_000 }),
      svc.listComplianceDsrs({ status: ["pending", "in_progress"] }, { take: 10_000 }),
    ])
    return complianceCounters({ productsIncomplete: products.length, dsrOpen: dsr.length })
  },
})
