import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { removeLink } from "../../../../../../../workflows/tasks/tasks"
import { onBoard, paramOf } from "../../../../helpers"

/** DELETE /admin/tasks/tasks/:id/links/:link_id: removes one link of the task. */
export async function DELETE(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => removeLink(req.scope, ctx, paramOf(req, "id"), paramOf(req, "link_id")))
}
