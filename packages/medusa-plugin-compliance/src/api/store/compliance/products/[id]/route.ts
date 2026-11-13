import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { complianceSvc, storeReadDue } from "../../../../../modules/compliance/lib/store"
import { gpsrPayload } from "../../../../compliance/helpers"

/**
 * GET /store/compliance/products/:id
 *
 * The GPSR info of a product for the distance-sales offer: the manufacturer,
 * the EU responsible person, the warnings and the safety info. Public, like
 * the offer itself.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const productId = req.params.id as string
  const svc = complianceSvc(req.scope)
  const rows = await svc.listComplianceProducts({ product_id: productId }, { take: 1 })
  if (rows.length === 0) {
    res.status(404).json({ type: "not_found", code: "not_found", message: "No compliance record for this product." })
    return
  }
  const payload = await gpsrPayload(req.scope, rows[0])
  /* The setup guide knows the storefront shows the GPSR block once it reads it. */
  if (storeReadDue(rows[0])) {
    const meta = rows[0].metadata && typeof rows[0].metadata === "object" ? rows[0].metadata : {}
    svc.updateComplianceProducts([{ id: rows[0].id, metadata: { ...meta, store_read_at: new Date().toISOString() } }]).catch(() => {
      /* a missed mark only delays the guide, never the offer */
    })
  }
  res.setHeader("Cache-Control", "public, max-age=300")
  res.json({ product: payload })
}
