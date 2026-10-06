import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { queueDraftOrder } from "../../../../../../workflows/negotiations/draft-orders"
import { adminThreadDto } from "../../../../../../workflows/negotiations/read"
import { envOf } from "../../../../../../workflows/negotiations/runtime"
import { adminThread } from "../../../../../../workflows/negotiations/threads"
import { actorLabel, answer } from "../../../helpers"

/**
 * POST /admin/negotiations/threads/:id/draft-order
 *
 * Queues the draft order of an accepted thread for the draft order writer
 * (a thread accepted before the writer was armed, or one that failed or was
 * blocked). Nothing is created here: the plan shows it, and the next run of
 * the armed writer creates it.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await answer(res, async () => {
    await queueDraftOrder(req.scope, String(req.params.id ?? ""), await actorLabel(req))
    const env = await envOf(req.scope)
    return { thread: await adminThreadDto(req.scope, env, await adminThread(env, String(req.params.id ?? ""))) }
  })
}
