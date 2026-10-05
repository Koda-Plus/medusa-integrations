import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isWriterKey } from "../../../../modules/subiekt/lib/writers"
import { setWriter } from "../../../../workflows/subiekt/writers"
import { actorName, subiektService } from "../helpers"

/**
 * POST /admin/subiekt/writers  { "writer": "prices" | "products" | "documents" | "contractors", "armed": true | false }
 *
 * The runtime toggle of a writer. Stores who flipped it and when. The option
 * in medusa-config.ts still wins: arming a writer its option forbids is
 * recorded, but the writer stays off (the answer says so in `allowed`).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const body = (req.body ?? {}) as { writer?: unknown; armed?: unknown }
  if (!isWriterKey(body.writer) || typeof body.armed !== "boolean") {
    res.status(400).json({ message: "Send { writer: prices | products | documents | contractors, armed: true | false }." })
    return
  }
  const actorId = (req as MedusaRequest & { auth_context?: { actor_id?: string } }).auth_context?.actor_id ?? null
  const writers = await setWriter(req.scope, body.writer, body.armed, await actorName(req.scope, actorId))
  res.json({ writers, mode: svc.isDemo() ? "demo" : "live" })
}
