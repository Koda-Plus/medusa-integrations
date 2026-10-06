import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureDemoStory } from "../../../workflows/negotiations/demo"
import { buildStatus } from "../../../workflows/negotiations/read"

/**
 * GET /admin/negotiations
 *
 * The status of the Negotiations page: the mode, the options in use, the
 * counters, what the active threads are worth, the writer, the last runs
 * and the stores running the plugin. In demo mode the first visit builds
 * the demo story (and a daily visit rebuilds it).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await ensureDemoStory(req.scope)
  res.json(await buildStatus(req.scope))
}
