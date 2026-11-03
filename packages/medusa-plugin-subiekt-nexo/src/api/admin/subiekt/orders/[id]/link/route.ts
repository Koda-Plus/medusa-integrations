import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { describeError } from "../../../../../../modules/subiekt/lib/bridge-client"
import { LinkError, linkOrderDocument } from "../../../../../../workflows/subiekt/reconcile-order"
import { subiektService } from "../../../helpers"

/**
 * POST /admin/subiekt/orders/:id/link  { "kind": "ZK", "number": "ZK 12/MAG/2026" }
 *
 * "Link" on the order page: Subiekt already has this document, the plugin has
 * no record of it (or an older status). Asks the bridge again, records the
 * document as Subiekt reports it now and settles the queue task waiting for
 * it, so no second document is created. Writes nothing in Subiekt.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  if (!svc.isDemo() && !svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  const body = (req.body ?? {}) as { kind?: unknown; number?: unknown }
  const kind = typeof body.kind === "string" ? body.kind.trim() : ""
  const number = typeof body.number === "string" ? body.number.trim() : ""
  if (!kind || !number || kind.length > 20 || number.length > 200) {
    res.status(400).json({ message: "`kind` and `number` of the document are required." })
    return
  }
  try {
    res.json(await linkOrderDocument(req.scope, req.params.id, kind, number))
  } catch (err) {
    if (err instanceof LinkError) {
      res.status(err.status).json({ message: err.message })
      return
    }
    const d = describeError(err)
    res.status(502).json({ message: `[${d.code}] ${svc.mask(d.message)}` })
  }
}
