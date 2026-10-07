import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SeedResponse } from "../../../../../modules/emails/lib/contract"
import { providerNote } from "../../../../../modules/emails/lib/provider-status"
import { ensureDemoOutbox } from "../../../../../workflows/emails/demo"
import { buildStatus, emailsService, serverError } from "../../helpers"

/**
 * POST /admin/emails/demo/seed
 *
 * Demo mode only: fills the simulated outbox from the store's newest orders
 * and customers, or rebuilds a stale seed with fresh dates (a fresh seed
 * stays as it is). The page sends it once when the status says the seed is
 * stale; the hourly housekeeping job does the same without visits. Sends
 * nothing. Outside demo mode, or when the provider of this process is not
 * in demo mode (it would really send), it answers 409 and writes nothing.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  if (!svc.isDemo()) {
    res.status(409).json({ code: "not_demo", message: "The demo outbox exists only in demo mode." })
    return
  }
  const note = providerNote()
  if (note && note.mode !== "demo") {
    res.status(409).json({ code: "provider_not_demo", message: "The provider of this process is not in demo mode: give it the same options as the plugin." })
    return
  }
  try {
    const written = await ensureDemoOutbox(req.scope, new Date())
    const body: SeedResponse = { written, status: await buildStatus(req.scope) }
    res.json(body)
  } catch (err) {
    serverError(req, res, err, "The demo outbox could not be prepared. The server log has the details.", 503)
  }
}
