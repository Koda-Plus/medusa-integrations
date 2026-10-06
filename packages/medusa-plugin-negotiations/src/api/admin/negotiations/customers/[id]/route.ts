import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureDemoStory } from "../../../../../workflows/negotiations/demo"
import { customerThreadsForAdmin } from "../../../../../workflows/negotiations/read"
import { isEntityId } from "../../../../../modules/negotiations/lib/text"

/**
 * GET /admin/negotiations/customers/:id
 *
 * The customer widget: the customer's latest ten threads and their count.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!isEntityId(id)) {
    res.status(404).json({ type: "not_found", code: "not_found", message: "Customer not found." })
    return
  }
  await ensureDemoStory(req.scope)
  res.json(await customerThreadsForAdmin(req.scope, id))
}
