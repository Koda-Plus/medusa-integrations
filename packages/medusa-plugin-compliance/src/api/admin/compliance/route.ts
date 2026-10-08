import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { complianceSvc, toConsent, toDsr, toProductCompliance, toResponsiblePerson } from "../../../modules/compliance/lib/store"
import { priceWindows, readVariants } from "../../../modules/compliance/lib/prices"
import { demoOf } from "../../compliance/helpers"
import type { ProductComplianceDto, StatusResponse } from "../../../modules/compliance/lib/contract"
import type { ConsentPurpose } from "../../../modules/compliance/lib/constants"

/**
 * GET /admin/compliance
 *
 * The whole status of the Compliance page in one call: the sections, the
 * responsible persons, the catalog products with their GPSR record (a product
 * without a record shows as incomplete), the data subject requests, the
 * consent summary and the Omnibus price windows.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = complianceSvc(req.scope)
  const options = svc.getOptions()
  const demo = demoOf(req.scope)

  const [persons, records, dsr, consents, variants] = await Promise.all([
    svc.listComplianceOperators({}, { take: 500 }),
    svc.listComplianceProducts({}, { take: 5000 }),
    svc.listComplianceDsrs({}, { take: 100, order: { created_at: "DESC" } }),
    svc.listComplianceConsents({}, { take: 1000 }),
    readVariants(req.scope),
  ])

  const personDtos = persons.map(toResponsiblePerson)
  const dsrDtos = dsr.map(toDsr)

  /* Catalog products LEFT JOIN their GPSR record: a product without one shows as incomplete. */
  const byProductId = new Map<string, ProductComplianceDto>()
  for (const r of records) {
    const dto = toProductCompliance(r)
    byProductId.set(dto.product_id, dto)
  }
  const seen = new Set<string>()
  const products: ProductComplianceDto[] = []
  for (const v of variants) {
    if (seen.has(v.product_id)) continue
    seen.add(v.product_id)
    const existing = byProductId.get(v.product_id)
    products.push(
      existing ?? {
        id: "",
        product_id: v.product_id,
        sku: v.sku,
        title: v.title,
        manufacturer_id: null,
        responsible_person_id: null,
        warnings: [],
        safety_info: null,
        complete: false,
        demo: false,
      },
    )
  }
  products.sort((a, b) => (a.sku ?? "").localeCompare(b.sku ?? ""))

  /* Consent summary, one row per purpose. */
  const byPurpose = new Map<string, { purpose: ConsentPurpose; granted: number; declined: number }>()
  for (const c of consents) {
    const dto = toConsent(c)
    const row = byPurpose.get(dto.purpose) ?? { purpose: dto.purpose, granted: 0, declined: 0 }
    if (dto.granted) row.granted += 1
    else row.declined += 1
    byPurpose.set(dto.purpose, row)
  }
  const consent = [...byPurpose.values()].sort((a, b) => a.purpose.localeCompare(b.purpose))

  const windows = await priceWindows(req.scope)

  const status: StatusResponse = {
    demo,
    sections: options.sections,
    counts: {
      responsible_persons: personDtos.length,
      products_total: products.length,
      products_complete: products.filter((p) => p.complete).length,
      dsr_open: dsrDtos.filter((d) => d.status === "pending" || d.status === "in_progress").length,
      consent_total: consents.length,
      snapshots: windows.reduce((n, w) => n + w.snapshots, 0),
    },
    responsible_persons: personDtos,
    products,
    dsr: dsrDtos,
    consent,
    prices: windows.map((w) => ({
      sku: w.sku,
      product_id: w.product_id,
      title: w.title,
      currency_code: w.currency_code,
      amount: w.amount,
      lowest_30d: w.lowest_30d,
      snapshots: w.snapshots,
    })),
  }

  res.json(status)
}
