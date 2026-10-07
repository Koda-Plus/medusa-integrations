import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { taskActivity } from "../../../../../../workflows/tasks/read"
import { onBoard, paramOf, queryOf } from "../../../helpers"

/** GET /admin/tasks/tasks/:id/activity: the task's activity log, newest first (`limit`, at most 100). */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => taskActivity(req.scope, ctx, paramOf(req, "id"), queryOf(req)))
}
