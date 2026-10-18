import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { importNewOrders } from "../../../../../workflows/vonhalsky/orders"
import { respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/orders/import: "Import now". Sandbox and live: 501
 * while the seller API is pending. Demo: the simulated marketplace has no
 * buyers of its own (use /demo/simulate-order).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respond(res, () => importNewOrders(req.scope))
}
