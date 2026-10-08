import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isOperatorKind } from "../../../../../modules/compliance/lib/constants"
import { complianceSvc, str, toResponsiblePerson } from "../../../../../modules/compliance/lib/store"
import { bodyOf, fail } from "../../../../compliance/helpers"

/**
 * POST /admin/compliance/responsible-persons/:id   update
 * DELETE /admin/compliance/responsible-persons/:id  delete
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = complianceSvc(req.scope)
  const id = req.params.id as string
  const body = bodyOf(req)
  const patch: Record<string, unknown> = {}
  if (isOperatorKind(body.kind)) patch.kind = body.kind
  if (str(body.name)) patch.name = str(body.name)
  if (body.address !== undefined) patch.address = str(body.address)
  if (body.email !== undefined) patch.email = str(body.email)
  if (body.country_code !== undefined) patch.country_code = str(body.country_code)
  if (Object.keys(patch).length === 0) {
    fail(res, 400, "nothing_to_change", "Nothing to change.")
    return
  }
  const updated = await svc.updateComplianceOperators([{ id, ...patch }])
  res.json({ responsible_person: toResponsiblePerson(updated[0]) })
}

export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = complianceSvc(req.scope)
  const id = req.params.id as string
  await svc.deleteComplianceOperators([id])
  res.json({ id })
}
