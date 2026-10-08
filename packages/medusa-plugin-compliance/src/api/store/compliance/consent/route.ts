import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isConsentPurpose } from "../../../../modules/compliance/lib/constants"
import { complianceSvc, str, toConsent } from "../../../../modules/compliance/lib/store"
import { bodyOf, customerIdOf, demoOf, fail } from "../../../compliance/helpers"

/**
 * POST /store/compliance/consent
 *
 * Records one consent decision from the cookie banner, the account page or
 * the checkout. Public: a visitor gives consent before logging in, so
 * `customer_id` is optional and only set when the request carries a logged-in
 * customer. Body: { purpose, granted, version?, source?, customer_id? }.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = complianceSvc(req.scope)
  const body = bodyOf(req)
  const purpose = body.purpose
  if (!isConsentPurpose(purpose)) {
    fail(res, 400, "invalid_purpose", "Unknown consent purpose.")
    return
  }
  const granted = body.granted === true || body.granted === "true"
  const customerId = str(body.customer_id) ?? customerIdOf(req)
  const source = str(body.source) ?? "cookie_banner"
  const version = str(body.version)

  const created = await svc.createComplianceConsents([
    { customer_id: customerId, purpose, granted, version, source, demo: demoOf(req.scope) },
  ])
  res.status(201).json({ consent: toConsent(created[0]) })
}
