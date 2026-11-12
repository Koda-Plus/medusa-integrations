import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { resumeWrites, retryImport, type SqlRunner } from "../../../../../../modules/ceneo/lib/import-claim"
import { WRITE_MAX_ATTEMPTS } from "../../../../../../modules/ceneo/lib/order-input"

/**
 * POST /admin/ceneo/orders/:id/retry
 *
 * A held or failed import goes back to the queue with fresh attempts; the
 * next run (within 5 minutes, or the import button) takes it. An imported
 * order whose writes to Ceneo wait for a person gets them resumed instead.
 * 409 when neither applies.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const sql = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as SqlRunner
  const id = String(req.params.id)
  if (await retryImport(sql, id)) {
    res.json({ ok: true, retried: "import" })
    return
  }
  if (await resumeWrites(sql, id, WRITE_MAX_ATTEMPTS)) {
    res.json({ ok: true, retried: "writes" })
    return
  }
  res.status(409).json({ code: "not_retryable", message: "Only a held or failed import, or writes that wait for a person, can be retried." })
}
