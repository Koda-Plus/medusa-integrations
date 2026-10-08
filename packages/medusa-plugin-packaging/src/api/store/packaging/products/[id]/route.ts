import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { packagingSvc, toProduct, toUnit } from "../../../../../modules/packaging/lib/store"

/**
 * GET /store/packaging/products/:id
 *
 * The packaging ladder of a product for the offer: the MOQ, the order step
 * and the units (piece, box, pallet) with their sizes. Public, like the
 * offer itself.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const productId = req.params.id as string
  const svc = packagingSvc(req.scope)
  const rows = await svc.listPackagingProducts({ product_id: productId }, { take: 1 })
  if (rows.length === 0) {
    res.status(404).json({ type: "not_found", code: "not_found", message: "No packaging set for this product." })
    return
  }
  const units = await svc.listPackagingUnits({ product_id: productId }, { take: 10 })
  res.setHeader("Cache-Control", "public, max-age=300")
  res.json({ packaging: toProduct(rows[0], units.map(toUnit)) })
}
