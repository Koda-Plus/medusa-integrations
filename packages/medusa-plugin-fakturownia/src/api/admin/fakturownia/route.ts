import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureDemoDocuments } from "../../../workflows/fakturownia/documents"
import { refreshDemoStatuses } from "../../../workflows/fakturownia/statuses"
import { buildStatus, fakturowniaService } from "./helpers"

/**
 * GET /admin/fakturownia
 *
 * Configuration summary (never the token), counters, the last run of each
 * kind and what runs right now. Reads the database only, never Fakturownia.
 * In demo mode the first visit backfills the newest orders.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  await ensureDemoDocuments(req.scope)
  await refreshDemoStatuses(req.scope)
  res.json(await buildStatus(svc))
}
