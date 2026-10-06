import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { adminThreadDto } from "../../../../../workflows/negotiations/read"
import { envOf } from "../../../../../workflows/negotiations/runtime"
import { adminThread } from "../../../../../workflows/negotiations/threads"
import { answer } from "../../helpers"

/**
 * GET /admin/negotiations/threads/:id
 *
 * One thread of the current mode with the whole conversation, internal notes
 * included, the customer, the product and the draft order record.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await answer(res, async () => {
    const env = await envOf(req.scope)
    const thread = await adminThread(env, req.params.id)
    return { thread: await adminThreadDto(req.scope, env, thread) }
  })
}
