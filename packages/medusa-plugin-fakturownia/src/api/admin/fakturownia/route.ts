import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildStatus } from "./helpers"

/**
 * GET /admin/fakturownia
 *
 * Configuration summary (never the token), counters, the last run of each
 * kind and what runs right now. READS THE DATABASE ONLY: never Fakturownia,
 * never a write. In demo mode `demoPrepared` says whether the sample
 * documents exist; the page asks for them once with
 * `POST /admin/fakturownia/demo/seed`, and the issue job prepares them too.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json(await buildStatus(req.scope))
}
