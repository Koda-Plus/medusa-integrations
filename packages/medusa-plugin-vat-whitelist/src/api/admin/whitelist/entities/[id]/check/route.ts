import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runCheck } from "../../../../../../workflows/whitelist/check"
import { whitelistSvc } from "../../../../../../modules/whitelist/lib/store"
import { fail } from "../../../../../whitelist/helpers"

/**
 * POST /admin/whitelist/entities/:id/check
 *
 * Re-checks the counterparty's number. In demo mode the answer is simulated;
 * otherwise the registry is asked again.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = whitelistSvc(req.scope)
  const id = req.params.id as string
  let entity: Record<string, unknown>
  try {
    entity = await svc.retrieveWhitelistEntity(id)
  } catch {
    fail(res, 404, "not_found", "No such counterparty.")
    return
  }
  const result = await runCheck(req.scope, { value: String(entity.nip ?? ""), requestedBy: "admin", customerId: typeof entity.customer_id === "string" ? entity.customer_id : null, force: true })
  res.json(result)
}
