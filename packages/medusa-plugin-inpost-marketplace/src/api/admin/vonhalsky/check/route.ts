import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CheckResponse } from "../../../../modules/vonhalsky/lib/contract"
import { logSync } from "../../../../modules/vonhalsky/lib/store"
import { clientOf, errorText, optionsOf } from "../../../../workflows/vonhalsky/runtime"

/**
 * POST /admin/vonhalsky/check: asks the marketplace for a token, the
 * organization and one offer, so a person knows the credentials work.
 * Reads only; the secret never leaves the server.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const client = clientOf(req.scope)
  if (!client) {
    const body: CheckResponse = { ok: false, organization: null, message: "The plugin has no credentials and is not in demo mode." }
    res.json(body)
    return
  }
  let body: CheckResponse
  try {
    const r = await client.check()
    body = { ok: true, organization: r.organization, message: null }
  } catch (err) {
    body = { ok: false, organization: null, message: errorText(err, req.scope) }
  }
  await logSync(req.scope, { area: "settings", action: "check", outcome: body.ok ? "ok" : "error", message: body.ok ? `Credentials work${body.organization ? ` (${body.organization})` : ""}.` : `Credentials check failed: ${body.message}`, demo: optionsOf(req.scope).demo })
  res.json(body)
}
