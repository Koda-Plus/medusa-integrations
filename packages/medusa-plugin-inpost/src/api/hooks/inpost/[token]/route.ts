import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { parseWebhook, secretMatches } from "../../../../modules/inpost/lib/webhook"
import { inBackground, inpostService } from "../../../../workflows/inpost/runtime"
import { handleWebhookCall } from "../../../../workflows/inpost/webhook"

/**
 * THE SHIPX WEBHOOK: https://<backend>/hooks/inpost/<webhookSecret>
 *
 * Public on purpose (ShipX calls it), so it trusts nothing but the secret in
 * the path, compared in constant time. A wrong secret, or a webhook that is
 * not configured (`webhookSecret` unset or invalid), answers 404: the route
 * does not admit it exists.
 *
 *   GET   InPost Manager checks the URL when it is saved: 200 with the right secret
 *   POST  a delivery: 200 at once (ShipX wants a quick answer); the shipment
 *         named in the body is then READ FROM SHIPX with the plugin's token and
 *         its status applied, once (see workflows/inpost/webhook.ts)
 *
 * InPost sends webhooks from 91.216.25.0/24 (production and sandbox).
 */

function authorized(req: MedusaRequest): boolean {
  const svc = inpostService(req.scope)
  const secret = svc.getOptions().webhookSecret
  return Boolean(secret) && secretMatches(req.params.token, secret)
}

function notFound(res: MedusaResponse): void {
  res.status(404).json({ type: "not_found", message: "Not found" })
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!authorized(req)) return notFound(res)
  res.status(200).json({ ok: true })
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  if (!authorized(req)) return notFound(res)
  const parsed = parseWebhook(req.body)
  if (!parsed.ok) {
    res.status(200).json({ ok: true, ignored: parsed.reason })
    return
  }
  res.status(200).json({ ok: true })
  const call = parsed.call
  inBackground(req.scope, `webhook ${call.event} ${call.shipmentId}`, () => handleWebhookCall(req.scope, call))
}
