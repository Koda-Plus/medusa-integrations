import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SIGNATURE_HEADER, SIGNATURE_TOLERANCE_SECONDS } from "../../../modules/subiekt/lib/constants"
import { verifySignature } from "../../../modules/subiekt/lib/signature"
import { pullEvents } from "../../../workflows/subiekt/events"
import { subiektService } from "../../../workflows/subiekt/runtime"

/**
 * POST /hooks/subiekt
 *
 * PUBLIC, SIGNED. The bridge says "new events are waiting" and Medusa reads
 * `GET /v1/events` in the background. The body carries nothing Medusa
 * trusts beyond that nudge: the documents themselves come from the feed,
 * through a signed request Medusa makes. A forged nudge could at most make
 * Medusa read the feed early, and the signature stops even that.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const o = svc.getOptions()

  if (o.demo) {
    // The demo bridge lives inside Medusa and needs no webhook.
    res.status(202).json({ accepted: false, demo: true })
    return
  }
  if (!svc.isConfigured()) {
    res.status(503).json({ error: { code: "not_configured", message: "The Subiekt plugin is not configured.", retryable: true } })
    return
  }

  const raw = (req as unknown as { rawBody?: Buffer | string }).rawBody
  const body = raw === undefined ? "" : raw
  const header = req.headers[SIGNATURE_HEADER]
  const verdict = verifySignature({
    header: Array.isArray(header) ? header[0] : header,
    secrets: [o.secret, o.previousSecret],
    method: "POST",
    pathAndQuery: req.originalUrl,
    body: typeof body === "string" ? body : new Uint8Array(body),
    toleranceSeconds: SIGNATURE_TOLERANCE_SECONDS,
  })
  if (!verdict.ok) {
    svc.getLogger().warn(`[subiekt] Webhook rejected: ${verdict.reason}.`)
    res.status(401).json({
      error: {
        code: verdict.reason === "stale" ? "stale_timestamp" : "invalid_signature",
        message: verdict.reason === "stale" ? "The signature timestamp is too far from the server clock." : "Invalid signature.",
        retryable: false,
      },
    })
    return
  }

  setImmediate(() => {
    pullEvents(req.scope, "webhook").catch((err: unknown) => {
      svc.getLogger().error(`[subiekt] Event read after webhook failed: ${svc.mask((err as Error)?.message ?? String(err))}`)
    })
  })
  res.status(202).json({ accepted: true })
}
