import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /admin/stripe/carts?ids=cart_1,cart_2
 *
 * Line items of the carts behind payments that never became an order
 * (abandoned, failed, waiting), for the Products column of the payments
 * list: what the shopper was about to buy. Medusa has no admin cart list, so
 * the plugin reads them itself. Read only, at most 100 ids, ids that are not
 * cart ids are skipped. A cart that is gone is simply missing from the answer.
 */
const FIELDS = [
  "id",
  "currency_code",
  "items.id",
  "items.title",
  "items.product_title",
  "items.variant_title",
  "items.thumbnail",
  "items.quantity",
  "items.unit_price",
  "items.variant_sku",
  "items.variant_barcode",
]

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost")
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter((s) => /^cart_[A-Za-z0-9]{6,60}$/.test(s)))].slice(0, 100)
  res.setHeader("Cache-Control", "no-store")
  if (!ids.length) {
    res.json({ carts: {} })
    return
  }
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as unknown as { graph: (q: Record<string, unknown>) => Promise<{ data: any[] }> }
    const { data } = await query.graph({ entity: "cart", fields: FIELDS, filters: { id: ids } })
    const carts: Record<string, { currency_code: string; items: unknown[] }> = {}
    for (const c of data ?? []) carts[c.id] = { currency_code: String(c.currency_code ?? "usd"), items: c.items ?? [] }
    res.json({ carts })
  } catch {
    /* A store without carts in reach (or a failed read): the column shows nothing, the page still works. */
    res.json({ carts: {} })
  }
}
