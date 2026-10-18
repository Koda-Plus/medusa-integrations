import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { clientOf, optionsOf } from "../../../../kit/helpers"
import { isActive } from "../../../../../modules/kit/lib/options"
import { kitSummary } from "../../../../../modules/kit/lib/integration"
import type { KitApiError } from "../../../../../modules/kit/lib/client"

/**
 * GET /admin/kit/integration/summary?entity=customer&id=... - the Kit state
 * of one customer: their subscriber record, looked up by the customer's
 * email. Read only; a failing key answers "unavailable".
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const entity = String(req.query.entity ?? "")
  const id = String(req.query.id ?? "")
  if (entity !== "customer" || !id) {
    return res.status(400).json({ message: "This summary answers for entity=customer with an id." })
  }

  const o = optionsOf(req.scope)
  if (!isActive(o)) {
    return res.json(kitSummary({ configured: false, subscriber: null, failed: false }))
  }

  let email: string | null = null
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({ entity: "customer", fields: ["id", "email"], filters: { id } })
    email = typeof (data as any[])[0]?.email === "string" ? (data as any[])[0].email : null
  } catch {
    email = null
  }
  if (!email) {
    return res.json(kitSummary({ configured: true, subscriber: null, failed: false }))
  }

  try {
    const subscriber = await clientOf(req.scope).subscriberByEmail(email)
    return res.json(kitSummary({ configured: true, subscriber: subscriber ? { state: subscriber.state, created_at: subscriber.created_at } : null, failed: false }))
  } catch (e) {
    const err = e as KitApiError
    if (err.kind === "rate") return res.status(429).json({ message: err.message })
    return res.json(kitSummary({ configured: true, subscriber: null, failed: true }))
  }
}
