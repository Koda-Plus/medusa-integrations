import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { retryImport, type SqlRunner } from "../../../../../../modules/ceneo/lib/import-claim"

/**
 * POST /admin/ceneo/orders/:id/retry
 *
 * A held or failed import goes back to the queue with fresh attempts; the
 * next run (within 5 minutes, or the import button) takes it. 409 when the
 * order is neither held nor failed.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const sql = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlRunner
  const ok = await retryImport(sql, String(req.params.id))
  if (!ok) {
    res.status(409).json({ code: "not_retryable", message: "Only a held or failed import can be retried." })
    return
  }
  res.json({ ok: true })
}
