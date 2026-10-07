import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { resetSandbox } from "../../../../../workflows/tasks/sandbox"
import { onBoard } from "../../helpers"

/**
 * POST /admin/tasks/sandbox/reset
 *
 * Everything on the sandbox board back to the sample tasks. Touches only the
 * sandbox board, so anyone in the admin may run it. 409 when no sandbox
 * accounts are configured.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => resetSandbox(req.scope, ctx))
}
