import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AllegroWriterToggleResponse } from "../../../../../modules/allegro/lib/contract"
import { isWriterKey } from "../../../../../modules/allegro/lib/writers"
import { WriterRefusedError, setWriterArmed } from "../../../../../workflows/allegro/writers"
import { actorOf, allegroService, errorOf } from "../../helpers"

/**
 * POST /admin/allegro/writers/:key  { armed: boolean }
 *
 * The runtime toggle of one writer (stock, orders, shipping, invoices,
 * prices, publish). Disarming always works. Arming is refused (409) while the
 * hard switch `writes.<key>` is off, the account is not connected or the
 * stored token lacks a scope the writer needs. The row records who flipped
 * it and when.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = allegroService(req.scope)
  const key = req.params.key
  if (!isWriterKey(key)) {
    res.status(404).json({ message: `Unknown writer ${String(key)}.` })
    return
  }
  const body = (req.body ?? {}) as { armed?: unknown }
  if (typeof body.armed !== "boolean") {
    res.status(400).json({ message: "Send { armed: true } or { armed: false }." })
    return
  }
  try {
    const writer = await setWriterArmed(svc, key, body.armed, await actorOf(req))
    const answer: AllegroWriterToggleResponse = { writer }
    res.json(answer)
  } catch (err) {
    res.status(err instanceof WriterRefusedError ? 409 : 500).json({ message: errorOf(svc, err) })
  }
}
