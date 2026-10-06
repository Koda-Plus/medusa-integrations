import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureDemoOutbox } from "../../../workflows/emails/demo"
import { buildStatus, emailsService } from "./helpers"

/**
 * GET /admin/emails
 *
 * The configuration in use (never the API key), the provider's state, the
 * templates with their switches and 30 day counts, the counters of the
 * Panel. Reads the database and the options only, never Resend. In demo mode
 * a visit fills the simulated outbox from the store's newest orders and
 * customers, or rebuilds it with fresh dates when the seed is stale.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = emailsService(req.scope)
  try {
    await ensureDemoOutbox(req.scope)
  } catch (err) {
    svc.getLogger().warn(`[emails] Demo outbox: ${svc.mask((err as Error)?.message ?? String(err))}`)
  }
  res.json(await buildStatus(req.scope))
}
