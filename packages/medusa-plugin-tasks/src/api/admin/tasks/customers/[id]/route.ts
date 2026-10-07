import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { entityTasks } from "../../../../../workflows/tasks/read"
import { onBoard, paramOf } from "../../helpers"

/** GET /admin/tasks/customers/:id: tasks of the board linked to this customer, for the widget on their page. */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => entityTasks(req.scope, ctx, "customer", paramOf(req, "id")))
}
