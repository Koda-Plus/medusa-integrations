import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { addLink } from "../../../../../../workflows/tasks/tasks"
import { bodyOf, onBoard, paramOf } from "../../../helpers"

/**
 * POST /admin/tasks/tasks/:id/links
 *
 * `{ type: "order" | "product" | "customer", id }` links the task to a
 * Medusa record that exists. Linking twice changes nothing. Answers
 * `{ link, created }`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await onBoard(req, res, (ctx) => addLink(req.scope, ctx, paramOf(req, "id"), bodyOf(req)))
}
