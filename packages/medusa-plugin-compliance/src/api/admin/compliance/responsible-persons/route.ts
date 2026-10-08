import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { isOperatorKind } from "../../../../modules/compliance/lib/constants"
import { complianceSvc, str, toResponsiblePerson } from "../../../../modules/compliance/lib/store"
import { bodyOf, demoOf, fail } from "../../../compliance/helpers"

/**
 * POST /admin/compliance/responsible-persons
 *
 * Creates a manufacturer, responsible person, importer or authorised
 * representative. Body: { kind, name, address?, email?, country_code? }.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = complianceSvc(req.scope)
  const body = bodyOf(req)
  const name = str(body.name)
  if (!name) {
    fail(res, 400, "name_required", "The operator needs a name.")
    return
  }
  const kind = isOperatorKind(body.kind) ? body.kind : "responsible_person"
  const created = await svc.createComplianceOperators([
    {
      kind,
      name,
      address: str(body.address),
      email: str(body.email),
      country_code: str(body.country_code),
      demo: demoOf(req.scope),
    },
  ])
  res.status(201).json({ responsible_person: toResponsiblePerson(created[0]) })
}
