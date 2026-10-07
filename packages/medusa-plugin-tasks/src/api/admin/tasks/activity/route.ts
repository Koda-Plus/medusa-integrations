import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { boardActivity } from "../../../../workflows/tasks/read"
import { onBoard, queryOf } from "../helpers"

/** GET /admin/tasks/activity: the latest activity across the board (`limit`, default 20, at most 100). */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => boardActivity(req.scope, ctx, queryOf(req)))
}
