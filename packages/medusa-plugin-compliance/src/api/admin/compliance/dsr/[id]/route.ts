import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isDsrStatus } from "../../../../../modules/compliance/lib/constants"
import { complianceSvc, str, toDsr } from "../../../../../modules/compliance/lib/store"
import { bodyOf, fail } from "../../../../compliance/helpers"

/**
 * POST /admin/compliance/dsr/:id
 *
 * Moves a data subject request through the queue: sets the status to
 * in_progress, completed or rejected, optionally with a note.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = complianceSvc(req.scope)
  const id = req.params.id as string
  const body = bodyOf(req)
  const status = isDsrStatus(body.status) ? body.status : null
  const note = body.note !== undefined ? str(body.note) : undefined
  if (!status && note === undefined) {
    fail(res, 400, "nothing_to_change", "Nothing to change.")
    return
  }
  const patch: Record<string, unknown> = { id }
  if (status) patch.status = status
  if (note !== undefined) patch.note = note
  const updated = await svc.updateComplianceDsrs([patch])
  res.json({ dsr: toDsr(updated[0]) })
}
