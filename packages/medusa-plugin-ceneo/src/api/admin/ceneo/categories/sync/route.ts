import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncCeneoCategoriesWorkflow } from "../../../../../workflows/ceneo/workflows"

/**
 * POST /admin/ceneo/categories/sync
 *
 * Downloads the Ceneo category tree now (it is also refreshed once a day).
 * Always 200 with the result: synced, failed (the previous tree stays) or
 * skipped (already running).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { result } = await syncCeneoCategoriesWorkflow(req.scope).run({ input: { trigger: "manual" } })
  res.json(result)
}
