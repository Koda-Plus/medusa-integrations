import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildCeneoFeedWorkflow } from "../../../../workflows/ceneo/workflows"

/**
 * POST /admin/ceneo/feed
 *
 * Builds the feed now, without waiting for the job, and answers with the
 * result, always with 200: built (with counters), failed (the previous file
 * stays served), or skipped (options missing, or a build already running in
 * this process). The result is the answer, not an HTTP error.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { result } = await buildCeneoFeedWorkflow(req.scope).run({ input: { trigger: "manual" } })
  res.json(result)
}
