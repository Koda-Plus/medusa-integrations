import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { complianceSvc, str, toProductCompliance } from "../../../../../modules/compliance/lib/store"
import { readVariants } from "../../../../../modules/compliance/lib/prices"
import { bodyOf, demoOf } from "../../../../compliance/helpers"

/**
 * POST /admin/compliance/products/:id
 *
 * Upserts the GPSR record of a product: the manufacturer and the responsible
 * person (operator ids), the warnings (one per line) and the safety info. The
 * record is complete when both the manufacturer and the responsible person
 * are set.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = complianceSvc(req.scope)
  const productId = req.params.id as string
  const body = bodyOf(req)

  let warnings: string[] = []
  if (Array.isArray(body.warnings)) {
    warnings = body.warnings
      .filter((w): w is string => typeof w === "string")
      .map((w) => w.trim())
      .filter((w) => w.length > 0)
      .slice(0, 12)
  } else if (typeof body.warnings === "string") {
    warnings = body.warnings
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0)
      .slice(0, 12)
  }

  const existing = await svc.listComplianceProducts({ product_id: productId }, { take: 1 })

  /* Denormalised SKU and title from the catalog, so the row reads without a join. */
  let sku: string | null = null
  let title: string | null = null
  if (existing.length === 0) {
    const variants = await readVariants(req.scope)
    const v = variants.find((x) => x.product_id === productId)
    sku = v?.sku ?? null
    title = v?.title ?? null
  }

  const manufacturerId = str(body.manufacturer_id)
  const responsibleId = str(body.responsible_person_id)

  if (existing.length === 0) {
    const created = await svc.createComplianceProducts([
      {
        product_id: productId,
        sku,
        title,
        manufacturer_id: manufacturerId,
        responsible_person_id: responsibleId,
        warnings,
        safety_info: str(body.safety_info),
        complete: Boolean(manufacturerId && responsibleId),
        demo: demoOf(req.scope),
      },
    ])
    res.status(201).json({ product: toProductCompliance(created[0]) })
    return
  }

  const updated = await svc.updateComplianceProducts([
    {
      id: existing[0].id,
      manufacturer_id: manufacturerId,
      responsible_person_id: responsibleId,
      warnings,
      safety_info: str(body.safety_info),
      complete: Boolean(manufacturerId && responsibleId),
    },
  ])
  res.json({ product: toProductCompliance(updated[0]) })
}
