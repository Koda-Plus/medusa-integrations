import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderOriginResponse } from "../../../../../modules/vonhalsky/lib/contract"
import { toOrderDto, vonHalskySvc } from "../../../../../modules/vonhalsky/lib/store"
import { optionsOf } from "../../../../../workflows/vonhalsky/runtime"

/** GET /admin/vonhalsky/medusa-orders/:id: whether a Medusa order came from the marketplace, for the order widget. Read only. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  const configured = optionsOf(req.scope).mode !== "off"
  if (!/^order_[A-Za-z0-9]+$/.test(id)) {
    res.json({ configured, order: null } satisfies OrderOriginResponse)
    return
  }
  const [row] = ((await vonHalskySvc(req.scope).listVonHalskyOrders({ order_id: id }, { take: 1 })) ?? []) as Array<Record<string, any>>
  const body: OrderOriginResponse = { configured, order: row ? toOrderDto(row) : null }
  res.json(body)
}
