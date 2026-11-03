import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { describeError } from "../../../../../../modules/subiekt/lib/bridge-client"
import { checkOrderInSubiekt } from "../../../../../../workflows/subiekt/reconcile-order"
import { markUnreachable } from "../../../../../../workflows/subiekt/runtime"
import { subiektService } from "../../../helpers"

/**
 * POST /admin/subiekt/orders/:id/check
 *
 * "Check in Subiekt" on the order page: asks the bridge which documents the
 * order has (`GET /v1/orders/{id}`) and compares them with the plugin tables.
 * Reads only, on both sides. A POST because it calls the bridge: rendering a
 * page never does.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  if (!svc.isDemo() && !svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  try {
    res.json(await checkOrderInSubiekt(req.scope, req.params.id))
  } catch (err) {
    const d = describeError(err)
    const message = svc.mask(d.message)
    if (d.retryable) await markUnreachable(svc, message).catch(() => undefined)
    res.status(502).json({ message: `[${d.code}] ${message}` })
  }
}
