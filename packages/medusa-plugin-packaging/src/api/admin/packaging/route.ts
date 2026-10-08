import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { packagingSvc, toProduct, toUnit } from "../../../modules/packaging/lib/store"
import { readVariants } from "../../../workflows/packaging/catalog"
import type { ProductDto, StatusResponse } from "../../../modules/packaging/lib/contract"

/**
 * GET /admin/packaging
 *
 * The whole status of the Packaging page in one call: every catalog product
 * with its ladder (a product without a record shows as unset) and the
 * counters.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = packagingSvc(req.scope)
  const options = svc.getOptions()
  const [records, units, variants] = await Promise.all([
    svc.listPackagingProducts({}, { take: 5000 }),
    svc.listPackagingUnits({}, { take: 10_000 }),
    readVariants(req.scope),
  ])
  const unitsByProduct = new Map<string, ReturnType<typeof toUnit>[]>()
  for (const u of units) {
    const dto = toUnit(u)
    const list = unitsByProduct.get(dto.product_id) ?? []
    list.push(dto)
    unitsByProduct.set(dto.product_id, list)
  }
  const recordsByProduct = new Map<string, ReturnType<typeof toProduct>>()
  for (const r of records) {
    const dto = toProduct(r, unitsByProduct.get(String(r.product_id)) ?? [])
    recordsByProduct.set(dto.product_id, dto)
  }
  const seen = new Set<string>()
  const products: ProductDto[] = []
  for (const v of variants) {
    if (seen.has(v.product_id)) continue
    seen.add(v.product_id)
    products.push(
      recordsByProduct.get(v.product_id) ?? {
        id: "",
        product_id: v.product_id,
        sku: v.sku,
        title: v.title,
        moq: 0,
        step: 0,
        units: [],
        demo: false,
      },
    )
  }
  products.sort((a, b) => (a.sku ?? "").localeCompare(b.sku ?? ""))

  const status: StatusResponse = {
    demo: options.demo,
    gs1Prefix: options.gs1Prefix,
    counts: {
      products: products.length,
      with_moq: products.filter((p) => p.moq > 0).length,
      with_sscc: products.filter((p) => p.units.some((u) => u.sscc_prefix)).length,
      units: units.length,
    },
    products,
  }

  res.json(status)
}
