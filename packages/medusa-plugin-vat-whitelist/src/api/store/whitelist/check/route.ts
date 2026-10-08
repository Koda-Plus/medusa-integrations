import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runCheck } from "../../../../workflows/whitelist/check"
import { customerIdOf, customerNip, fail } from "../../../whitelist/helpers"

/**
 * POST /store/whitelist/check
 *
 * Asks for a fresh check of the logged-in customer's own company NIP and
 * links the counterparty to the customer.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = customerIdOf(req)
  if (!customerId) {
    fail(res, 401, "unauthorized", "Log in to check your company.")
    return
  }
  const nip = await customerNip(req.scope, customerId)
  if (!nip) {
    fail(res, 400, "no_nip", "Your profile has no company NIP.")
    return
  }
  const result = await runCheck(req.scope, { value: nip, requestedBy: "store", customerId })
  res.status(201).json(result)
}
