import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildStatus, serverError } from "./helpers"

/**
 * GET /admin/emails
 *
 * The configuration in use (never the API key), the provider's state, the
 * templates with their switches and 30 day counts, the counters of the
 * Panel. Reads the database and the options only, never Resend, and writes
 * nothing: in demo mode the answer says when the simulated outbox was seeded
 * and whether it is stale; the page then asks `POST /admin/emails/demo/seed`.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    res.json(await buildStatus(req.scope))
  } catch (err) {
    serverError(req, res, err, "The e-mails status could not be read. The server log has the details.")
  }
}
