import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureSandbox } from "../../../../../workflows/tasks/sandbox"
import { onBoard } from "../../helpers"

/**
 * POST /admin/tasks/sandbox/ensure
 *
 * The Tasks page of a sandbox account asks for its sample tasks when the
 * status says the sandbox board is stale (`sandbox_board.stale`). Seeds only
 * then, and only the sandbox board; for everyone else a no-op. Answers
 * `{ seeded }`. Reads never seed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, async (ctx) => ({ seeded: await ensureSandbox(req.scope, ctx) }))
}
