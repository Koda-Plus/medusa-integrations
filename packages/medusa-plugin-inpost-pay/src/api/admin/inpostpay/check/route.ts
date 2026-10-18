import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { InpostPayApiError } from "../../../../modules/inpostpay/lib/client"
import { clientOf, optionsOf } from "../../../../workflows/inpostpay/runtime"

/**
 * GET /admin/inpostpay/check: a live connection check: an OAuth token for
 * the keys (sandbox or production). Demo answers at once without a call.
 * The secret never leaves the server.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const o = optionsOf(req.scope)
  const client = clientOf(req.scope)
  if (!client) {
    res.status(400).json({ ok: false, code: "unconfigured", message: "No InPost Pay keys: set clientId, clientSecret and merchantClientId." })
    return
  }
  try {
    const r = await client.check()
    res.json({ ok: true, mode: o.mode, expires_in: r.expiresIn, checked_at: new Date().toISOString() })
  } catch (e) {
    const err = e instanceof InpostPayApiError ? e : new InpostPayApiError(0, "error", String((e as Error)?.message ?? e))
    res.status(err.kind === "auth" ? 401 : 502).json({ ok: false, code: err.kind, message: err.message })
  }
}
