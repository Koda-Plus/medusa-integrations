import type { AuthenticatedMedusaRequest, MedusaRequest } from "@medusajs/framework/http"

export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}

/** The admin user who acts, kept next to consents, approvals and new presentations. */
export function actorOf(req: MedusaRequest): string | null {
  const id = (req as AuthenticatedMedusaRequest).auth_context?.actor_id
  return typeof id === "string" && id ? id : null
}

type Res = { status: (c: number) => { json: (b: unknown) => void } }

/** Problems as codes: the admin translates them and marks the fields. */
export function problems(res: Res, status: number, codes: string[]): void {
  res.status(status).json({ type: status === 404 ? "not_found" : status === 409 ? "conflict" : "invalid_data", code: codes[0] ?? "invalid", problems: codes, message: codes.join(", ") })
}
