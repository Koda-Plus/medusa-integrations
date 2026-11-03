import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { simulateCase } from "../../../../../workflows/vonhalsky/cases"
import { respond } from "../../../../vonhalsky/admin-helpers"

/**
 * POST /admin/vonhalsky/demo/simulate-case { kind: "return" | "claim", orderId? }:
 * DEMO MODE ONLY. A sample return or claim on a simulated order, read in
 * by the sync as a real one would be. Nothing is sent outside.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as { kind?: unknown; orderId?: unknown }
  await respond(res, () => simulateCase(req.scope, body.kind, body.orderId))
}
