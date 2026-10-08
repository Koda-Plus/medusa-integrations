import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toEntity, whitelistSvc } from "../../../../modules/whitelist/lib/store"
import { customerIdOf, customerNip } from "../../../whitelist/helpers"

/**
 * GET /store/whitelist/me
 *
 * The logged-in customer's own counterparty status, from the company NIP in
 * their profile. Reads only: no check is run here, the customer asks for a
 * fresh one with POST /store/whitelist/check.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const customerId = customerIdOf(req)
  if (!customerId) {
    res.status(401).json({ type: "unauthorized", code: "unauthorized", message: "Log in to see your status." })
    return
  }
  const nip = await customerNip(req.scope, customerId)
  if (!nip) {
    res.status(404).json({ type: "not_found", code: "no_nip", message: "Your profile has no company NIP." })
    return
  }
  const svc = whitelistSvc(req.scope)
  const rows = await svc.listWhitelistEntities({ nip }, { take: 1 })
  if (rows.length === 0) {
    res.status(404).json({ type: "not_found", code: "not_checked", message: "Your company has not been checked yet." })
    return
  }
  res.json({ entity: toEntity(rows[0], svc.getOptions().staleHours) })
}
