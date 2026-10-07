import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { taskDetail } from "../../../../../workflows/tasks/read"
import { deleteTask, updateTask } from "../../../../../workflows/tasks/tasks"
import { bodyOf, onBoard, paramOf } from "../../helpers"

/**
 * GET /admin/tasks/tasks/:id
 *
 * One task of the board with its comments, links and activity. A task of
 * another board answers 404, like one that does not exist.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, async (ctx) => ({ task: await taskDetail(req.scope, ctx, paramOf(req, "id")) }))
}

/**
 * POST /admin/tasks/tasks/:id
 *
 * Changes any of `title`, `description`, `status` (the task goes to the end
 * of its new column), `priority`, the assignee (`assignee_id`,
 * `assignee_email`, `assignee`, null to unassign), `due_date` (null to
 * clear) and `tags`. Answers `{ task }`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, async (ctx) => ({ task: await updateTask(req.scope, ctx, paramOf(req, "id"), bodyOf(req)) }))
}

/**
 * DELETE /admin/tasks/tasks/:id
 *
 * Deletes the task (a soft delete, with its comments, links and activity).
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => deleteTask(req.scope, ctx, paramOf(req, "id")))
}
