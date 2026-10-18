import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { simulateOrder } from "../../../../../workflows/vonhalsky/orders"
import { respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/demo/simulate-order: DEMO MODE ONLY. A sample
 * marketplace order from the listed offers (a sample buyer with an
 * example.com address and a sample parcel locker), imported as a real
 * Medusa order in the "InPost Von Halsky (demo)" sales channel. Nothing is
 * sent outside.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respond(res, () => simulateOrder(req.scope))
}
