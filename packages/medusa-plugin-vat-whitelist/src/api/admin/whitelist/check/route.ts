import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runCheck } from "../../../../workflows/whitelist/check"
import { parseNumber } from "../../../../modules/whitelist/lib/check"
import { bodyOf, fail } from "../../../whitelist/helpers"

/**
 * POST /admin/whitelist/check
 *
 * Checks a Polish NIP (GUS and the whitelist, as plRegistries says) or an
 * EU VAT number (VIES). Body: { nip }. Creates or refreshes the counterparty
 * and appends one check per registry to the history. A number that does not
 * validate answers 400 and saves nothing, so a typo leaves no counterparty.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = bodyOf(req)
  const value = typeof body.nip === "string" ? body.nip.trim() : ""
  if (!value) {
    fail(res, 400, "nip_required", "Enter a NIP or a VAT number.")
    return
  }
  const parsed = parseNumber(value)
  if (parsed.kind === "invalid") {
    fail(res, 400, "invalid", parsed.country === "PL" ? "The NIP does not validate: 10 digits with a valid checksum." : "Not an EU VAT number: a member state prefix (DE, FR, EL...) and the number.")
    return
  }
  const requestedBy = typeof body.customer_id === "string" ? "store" : "admin"
  const result = await runCheck(req.scope, { value, requestedBy, customerId: typeof body.customer_id === "string" ? body.customer_id : null })
  res.status(201).json(result)
}
