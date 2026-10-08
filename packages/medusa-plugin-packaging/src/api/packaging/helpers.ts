import type { MedusaRequest } from "@medusajs/framework/http"
import { str } from "../../modules/packaging/lib/store"

export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}

export function fail(res: { status: (c: number) => { json: (b: unknown) => void } }, status: number, code: string, message: string): void {
  res.status(status).json({ type: status === 404 ? "not_found" : "invalid_data", code, message })
}

export { str }
