import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { creditSvc } from "../../../../../../modules/credit/lib/store"
import { fail } from "../../../../../credit/helpers"

/**
 * Store mode: POST /admin/credit/orders/:id/hide takes an order off the credit
 * page for good (a test order). The store marks the order; nothing is deleted.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const store = creditSvc(req.scope).getOptions?.()?.store
  const id = String(req.params.id ?? "")
  if (!store?.hideOrder) return fail(res, 404, "not_supported", "This store does not hide orders from the credit page.")
  if (!/^[A-Za-z0-9_]{1,80}$/.test(id)) return fail(res, 400, "invalid_order", "The order id is not valid.")
  const ctx = (req as MedusaRequest & { auth_context?: { actor_id?: string | null } | null }).auth_context
  try {
    await store.hideOrder(req.scope, id, { id: typeof ctx?.actor_id === "string" ? ctx.actor_id : null })
    res.json({ hidden: true })
  } catch (err) {
    fail(res, 400, "not_hidden", (err as Error)?.message || "The order was not hidden.")
  }
}
