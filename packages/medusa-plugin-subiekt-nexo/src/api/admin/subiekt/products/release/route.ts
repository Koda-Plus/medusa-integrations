import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { subiektService } from "../../helpers"

/**
 * POST /admin/subiekt/products/release  { "id": "sbqrn_..." }
 *
 * A person looked at an item that failed three runs in a row and lets the
 * writer try it again: the failure count goes back to zero. A POST, not a
 * DELETE: the row stays as the history of what happened.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const id = String((req.body as { id?: unknown } | undefined)?.id ?? "")
  const rows = (await svc.listSubiektCatalogQuarantines({ id, demo: svc.isDemo() } as never, { take: 1 } as never)) as unknown as Array<{ id: string }>
  if (!rows[0]) {
    res.status(404).json({ message: "Quarantined item not found." })
    return
  }
  await svc.updateSubiektCatalogQuarantines({ id, failures: 0, quarantined: false } as never)
  res.json({ released: true })
}
