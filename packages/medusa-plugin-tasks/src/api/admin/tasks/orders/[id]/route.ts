import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { entityTasks } from "../../../../../workflows/tasks/read"
import { onBoard, paramOf } from "../../helpers"

/** GET /admin/tasks/orders/:id: tasks of the board linked to this order, for the widget on its page. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => entityTasks(req.scope, ctx, "order", paramOf(req, "id")))
}
