import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminList } from "../../../../workflows/negotiations/read"

/**
 * GET /admin/negotiations/threads
 *
 * The queue, latest activity first. Query: `status` (all, waiting, open,
 * counter_offered, accepted, rejected, expired), `q` (reference, SKU, title,
 * or a customer or product the phrase finds), `customer_id`, `product_id`,
 * `limit` (up to 100), `offset`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json(await adminList(req.scope, (req.query ?? {}) as Record<string, unknown>))
}
