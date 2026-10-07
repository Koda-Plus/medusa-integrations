import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { taskComments } from "../../../../../../workflows/tasks/read"
import { addComment } from "../../../../../../workflows/tasks/tasks"
import { bodyOf, onBoard, paramOf } from "../../../helpers"

/** GET /admin/tasks/tasks/:id/comments: the task's comments, oldest first. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => taskComments(req.scope, ctx, paramOf(req, "id")))
}

/**
 * POST /admin/tasks/tasks/:id/comments
 *
 * `{ body }`. An admin user comments under their name; a secret API key as
 * an AI agent (role `claude`) under the name it sends in `author`, else the
 * key's title. Answers `{ comment }` (201).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, async (ctx) => ({ comment: await addComment(req.scope, ctx, paramOf(req, "id"), bodyOf(req)) }), 201)
}
