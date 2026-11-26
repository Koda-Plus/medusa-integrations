import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { checkCeneoApi } from "../../../../workflows/ceneo/orders"

/**
 * GET /admin/ceneo/api
 *
 * Tests the API key: a fresh token, then the execution limits per method.
 * The key never leaves the server.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.setHeader("Cache-Control", "no-store")
  res.json(await checkCeneoApi(req.scope))
}
