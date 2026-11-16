import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { importCeneoOrdersWorkflow } from "../../../../../workflows/ceneo/workflows"

/**
 * POST /admin/ceneo/orders/import
 *
 * Runs the import and the writes to Ceneo now (what the 5-minute job does
 * after the sync). Each part answers off, skipped or ran.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { result } = await importCeneoOrdersWorkflow(req.scope).run({ input: { trigger: "manual" } })
  res.json(result)
}
