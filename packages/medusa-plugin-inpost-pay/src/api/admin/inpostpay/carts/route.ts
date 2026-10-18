import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { inpostPaySvc } from "../../../../modules/inpostpay/lib/store"

/**
 * GET /admin/inpostpay/carts?ids=cart_a,cart_b: the line items of carts that
 * never became an order (the products column of the panel). Only carts of
 * InPost Pay baskets, at most 100. Read only.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^cart_[A-Za-z0-9]+$/.test(s))
    .slice(0, 100)
  if (ids.length === 0) {
    res.json({ carts: {} })
    return
  }
  const rows = (await inpostPaySvc(req.scope).listInpostPayBaskets({ cart_id: ids }, { take: ids.length })) as Array<{ cart_id: string }>
  const allowed = rows.map((r) => r.cart_id)
  if (allowed.length === 0) {
    res.json({ carts: {} })
    return
  }
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data } = await query.graph({ entity: "cart", fields: ["id", "currency_code", "items.*"], filters: { id: allowed } })
  const carts: Record<string, unknown> = {}
  for (const c of data as any[]) carts[c.id] = { currency_code: c.currency_code, items: c.items ?? [] }
  res.json({ carts })
}
