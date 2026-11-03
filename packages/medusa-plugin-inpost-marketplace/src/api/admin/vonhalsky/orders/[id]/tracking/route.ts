import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toOrderDto, vonHalskySvc } from "../../../../../../modules/vonhalsky/lib/store"
import { syncTracking } from "../../../../../../workflows/vonhalsky/tracking"
import { respond } from "../../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/orders/:id/tracking: reads the tracking numbers of
 * the Medusa order and the marketplace order again, and says whether InPost
 * shows the parcels (linked) or not yet (waiting).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!/^vhord_[A-Za-z0-9]+$/.test(id)) {
    res.status(400).json({ code: "bad_id", message: "Not a marketplace order id of this plugin." })
    return
  }
  await respond(res, async () => {
    const [row] = ((await vonHalskySvc(req.scope).listVonHalskyOrders({ id }, { take: 1 })) ?? []) as Array<Record<string, any>>
    if (!row?.order_id) return { outcome: "none", order: row ? toOrderDto(row) : null }
    return syncTracking(req.scope, String(row.order_id), { fresh: true })
  })
}
