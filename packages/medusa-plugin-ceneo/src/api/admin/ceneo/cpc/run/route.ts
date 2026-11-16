import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runCeneoCpcWorkflow } from "../../../../../workflows/ceneo/workflows"

/**
 * POST /admin/ceneo/cpc/run
 *
 * The hourly CPC run now: bids and the top 10 read, then the armed writers
 * (bids, promotion texts). Answers ran, failed, skipped or off.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { result } = await runCeneoCpcWorkflow(req.scope).run({ input: { trigger: "manual" } })
  res.json(result)
}
