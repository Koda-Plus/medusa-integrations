import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncCeneoOrdersWorkflow } from "../../../../../workflows/ceneo/workflows"

/**
 * POST /admin/ceneo/orders/sync
 *
 * Reads the Kup Teraz orders of the last 14 days now. Always 200 with the
 * result: synced, failed, skipped (already running) or off (no API key).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { result } = await syncCeneoOrdersWorkflow(req.scope).run({ input: { trigger: "manual" } })
  res.json(result)
}
