import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isDsrType } from "../../../../modules/compliance/lib/constants"
import { complianceSvc, str, toDsr } from "../../../../modules/compliance/lib/store"
import { bodyOf, customerIdOf, demoOf, fail } from "../../../compliance/helpers"

/**
 * GET /store/compliance/dsr
 *
 * The logged-in customer's own data subject requests, newest first.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = customerIdOf(req)
  if (!customerId) {
    fail(res, 401, "unauthorized", "Log in to file or view your requests.")
    return
  }
  const svc = complianceSvc(req.scope)
  const rows = await svc.listComplianceDsrs({ customer_id: customerId }, { take: 50, order: { created_at: "DESC" } })
  res.json({ dsr: rows.map(toDsr) })
}

/**
 * POST /store/compliance/dsr
 *
 * Files a data subject request for the logged-in customer: access, erasure,
 * portability, restriction, objection or rectification. Body: { type, note? }.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = customerIdOf(req)
  if (!customerId) {
    fail(res, 401, "unauthorized", "Log in to file a request.")
    return
  }
  const body = bodyOf(req)
  const type = body.type
  if (!isDsrType(type)) {
    fail(res, 400, "invalid_type", "Unknown request type.")
    return
  }
  const svc = complianceSvc(req.scope)
  const created = await svc.createComplianceDsrs([
    { customer_id: customerId, customer_email: str(body.email) ?? null, type, note: str(body.note), status: "pending", demo: demoOf(req.scope) },
  ])
  res.status(201).json({ dsr: toDsr(created[0]) })
}
