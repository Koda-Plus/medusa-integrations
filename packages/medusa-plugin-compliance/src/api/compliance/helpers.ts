import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest } from "@medusajs/framework/http"
import { complianceSvc, str, toResponsiblePerson } from "../../modules/compliance/lib/store"

/** The plugin is in demo mode. */
export function demoOf(scope: MedusaContainer): boolean {
  try {
    return complianceSvc(scope).isDemo()
  } catch {
    return false
  }
}

export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}

/** The logged-in customer of a store request, or null. */
export function customerIdOf(req: MedusaRequest): string | null {
  const ctx = (req as MedusaRequest & { auth_context?: { actor_id?: string | null; actor_type?: string | null } | null }).auth_context
  if (!ctx || ctx.actor_type !== "customer") return null
  return typeof ctx.actor_id === "string" && ctx.actor_id ? ctx.actor_id : null
}

export function fail(res: { status: (c: number) => { json: (b: unknown) => void } }, status: number, code: string, message: string): void {
  res.status(status).json({ type: status === 404 ? "not_found" : "invalid_data", code, message })
}

/** A GPSR payload for the storefront: manufacturer and responsible person with contact details. */
export async function gpsrPayload(scope: MedusaContainer, product: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const svc = complianceSvc(scope)
  const manufacturerId = str(product.manufacturer_id)
  const responsibleId = str(product.responsible_person_id)
  const ids = [manufacturerId, responsibleId].filter((x): x is string => Boolean(x))
  const persons = ids.length > 0 ? await svc.listComplianceOperators({ id: ids }, { take: ids.length }) : []
  const byId = new Map(persons.map((p) => [p.id, toResponsiblePerson(p)]))
  const warnings = Array.isArray(product.warnings) ? product.warnings.filter((w): w is string => typeof w === "string") : []
  return {
    product_id: str(product.product_id) ?? "",
    sku: str(product.sku),
    complete: Boolean(manufacturerId && responsibleId),
    manufacturer: manufacturerId ? (byId.get(manufacturerId) ?? null) : null,
    responsible_person: responsibleId ? (byId.get(responsibleId) ?? null) : null,
    warnings,
    safety_info: str(product.safety_info),
  }
}
