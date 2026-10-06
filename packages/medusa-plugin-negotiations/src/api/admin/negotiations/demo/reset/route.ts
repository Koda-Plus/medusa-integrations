import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureDemoStory } from "../../../../../workflows/negotiations/demo"
import { ActionError, envOf } from "../../../../../workflows/negotiations/runtime"
import { answer } from "../../helpers"

/**
 * POST /admin/negotiations/demo/reset
 *
 * Demo mode only: rebuilds the demo story now, as it does by itself once a
 * day. Threads the story did not create are not touched.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await answer(res, async () => {
    const env = await envOf(req.scope)
    if (!env.options.demo) throw new ActionError(409, "not_demo", "The demo story exists only in demo mode.")
    await ensureDemoStory(req.scope, { force: true, trigger: "manual" })
    return { ok: true }
  })
}
