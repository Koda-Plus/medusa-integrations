import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureDemoDocuments } from "../../../workflows/fakturownia/documents"
import { ensureDemoExtras } from "../../../workflows/fakturownia/demo"
import { refreshDemoStatuses } from "../../../workflows/fakturownia/statuses"
import { buildStatus } from "./helpers"

/**
 * GET /admin/fakturownia
 *
 * Configuration summary (never the token), counters, the last run of each
 * kind and what runs right now. Reads the database only, never Fakturownia.
 * In demo mode the first visit backfills the newest orders, then (once per
 * store) seeds what 0.2.0 shows: KSeF histories, a correction plan and a few
 * unpaid invoices for reminders.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await ensureDemoDocuments(req.scope)
  await ensureDemoExtras(req.scope)
  await refreshDemoStatuses(req.scope)
  res.json(await buildStatus(req.scope))
}
