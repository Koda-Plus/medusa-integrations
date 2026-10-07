import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { prepareDemo } from "../../../../../workflows/fakturownia/demo"
import { buildStatus, fakturowniaService } from "../../helpers"

/**
 * POST /admin/fakturownia/demo/seed
 *
 * Demo mode only: the sample documents of the simulated account, prepared
 * now instead of at the next run of the issue job (the newest orders get
 * their documents, then once per store the KSeF histories, a correction plan
 * and a few unpaid invoices). Idempotent: a second call finds them there and
 * does nothing. The page calls it once when `demoPrepared` is false. Answers
 * the status, like `GET /admin/fakturownia`. 409 in live mode.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  if (!svc.isDemo()) {
    res.status(409).json({ message: "Sample data exists only in demo mode (demo: true)." })
    return
  }
  await prepareDemo(req.scope)
  res.json(await buildStatus(req.scope))
}
