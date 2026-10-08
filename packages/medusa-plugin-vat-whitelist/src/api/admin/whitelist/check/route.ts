import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runCheck } from "../../../../workflows/whitelist/check"
import { bodyOf, fail } from "../../../whitelist/helpers"

/**
 * POST /admin/whitelist/check
 *
 * Checks a Polish NIP against the whitelist or an EU VAT number against
 * VIES. Body: { nip }. Creates or refreshes the counterparty and appends the
 * check to the history.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = bodyOf(req)
  const value = typeof body.nip === "string" ? body.nip.trim() : ""
  if (!value) {
    fail(res, 400, "nip_required", "Enter a NIP or a VAT number.")
    return
  }
  const requestedBy = typeof body.customer_id === "string" ? "store" : "admin"
  const result = await runCheck(req.scope, { value, requestedBy, customerId: typeof body.customer_id === "string" ? body.customer_id : null })
  res.status(201).json(result)
}
