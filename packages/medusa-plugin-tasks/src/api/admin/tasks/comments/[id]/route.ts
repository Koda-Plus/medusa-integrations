import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { deleteComment, editComment } from "../../../../../workflows/tasks/tasks"
import { bodyOf, onBoard, paramOf } from "../../helpers"

/** POST /admin/tasks/comments/:id: `{ body }`, the author changes their comment. */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, async (ctx) => ({ comment: await editComment(req.scope, ctx, paramOf(req, "id"), bodyOf(req)) }))
}

/** DELETE /admin/tasks/comments/:id: the author deletes their comment. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => deleteComment(req.scope, ctx, paramOf(req, "id")))
}
