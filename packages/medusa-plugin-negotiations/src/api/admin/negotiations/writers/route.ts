import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isWriterKey } from "../../../../modules/negotiations/lib/writers"
import { setWriter, toWriterDto } from "../../../../workflows/negotiations/draft-orders"
import { ActionError } from "../../../../workflows/negotiations/runtime"
import { actorLabel, answer, bodyOf } from "../helpers"

/**
 * POST /admin/negotiations/writers
 *
 * `{ writer: "draftOrders", on: boolean }`: arms or disarms a writer in the
 * current mode, recording who and when. Arming is refused when the plugin
 * options turn the writer off (`writers.draftOrders: false`).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await answer(res, async () => {
    const body = bodyOf(req)
    if (!isWriterKey(body.writer) || typeof body.on !== "boolean") {
      throw new ActionError(400, "invalid_data", "Send { writer: \"draftOrders\", on: true | false }.")
    }
    const state = await setWriter(req.scope, body.writer, body.on, await actorLabel(req))
    return { writer: toWriterDto(state) }
  })
}
