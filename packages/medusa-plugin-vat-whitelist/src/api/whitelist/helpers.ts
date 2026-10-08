import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { str } from "../../modules/whitelist/lib/store"

/** The logged-in customer of a store request, or null. */
export function customerIdOf(req: MedusaRequest): string | null {
  const ctx = (req as MedusaRequest & { auth_context?: { actor_id?: string | null; actor_type?: string | null } | null }).auth_context
  if (!ctx || ctx.actor_type !== "customer") return null
  return typeof ctx.actor_id === "string" && ctx.actor_id ? ctx.actor_id : null
}

export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}

export function fail(res: { status: (c: number) => { json: (b: unknown) => void } }, status: number, code: string, message: string): void {
  res.status(status).json({ type: status === 404 ? "not_found" : "invalid_data", code, message })
}

/** The company NIP of a customer, from their metadata; null without one. */
export async function customerNip(container: MedusaContainer, customerId: string): Promise<string | null> {
  try {
    const customer = await container.resolve(Modules.CUSTOMER).retrieveCustomer(customerId, { select: ["id", "metadata"] })
    return str((customer?.metadata as Record<string, unknown> | null | undefined)?.nip)
  } catch {
    return null
  }
}
