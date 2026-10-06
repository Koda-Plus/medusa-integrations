import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { expireNegotiations } from "../../../../workflows/negotiations/expire"
import { answer } from "../helpers"

/**
 * POST /admin/negotiations/expire
 *
 * Runs the expiry pass now (it also runs every hour). Live threads only: in
 * demo mode the answer is a skipped run, demo threads keep their story.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await answer(res, async () => ({ run: await expireNegotiations(req.scope, "manual") }))
}
