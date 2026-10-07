import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { moveTask } from "../../../../../../workflows/tasks/tasks"
import { bodyOf, onBoard, paramOf } from "../../../helpers"

/**
 * POST /admin/tasks/tasks/:id/move
 *
 * Drag and drop: `{ status, after_id?, before_id? }` places the task in
 * `status` right after `after_id`, else right before `before_id`, else at
 * the end of the column, and numbers the columns it left and joined again.
 * Answers `{ task }`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, async (ctx) => ({ task: await moveTask(req.scope, ctx, paramOf(req, "id"), bodyOf(req)) }))
}
