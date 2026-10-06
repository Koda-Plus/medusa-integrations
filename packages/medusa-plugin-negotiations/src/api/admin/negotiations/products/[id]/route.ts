import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ensureDemoStory } from "../../../../../workflows/negotiations/demo"
import { productThreads } from "../../../../../workflows/negotiations/read"
import { isEntityId } from "../../../../../modules/negotiations/lib/text"

/**
 * GET /admin/negotiations/products/:id
 *
 * The product widget: the latest ten threads about the product (by product
 * id, and older threads that only carry one of its SKUs) and their count.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const id = String(req.params.id ?? "")
  if (!isEntityId(id)) {
    res.status(404).json({ type: "not_found", code: "not_found", message: "Product not found." })
    return
  }
  await ensureDemoStory(req.scope)
  res.json(await productThreads(req.scope, id))
}
