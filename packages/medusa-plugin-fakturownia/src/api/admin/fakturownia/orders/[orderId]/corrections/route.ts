import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { planCorrections } from "../../../../../../workflows/fakturownia/corrections"
import { getPlan } from "../../../../../../workflows/fakturownia/runtime"
import { fakturowniaService, planDtos } from "../../../helpers"

/**
 * POST /admin/fakturownia/orders/:orderId/corrections
 *
 * "Check for corrections" on the order page: the plan of the order's issued
 * document is computed now (from Medusa, nothing is sent to Fakturownia).
 * Answers what happened: `created`, `updated`, `unchanged`, `obsolete`,
 * `none` (nothing to correct) or `skipped` (corrections off, demo simulation).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  if (!svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  const outcome = await planCorrections(req.scope, req.params.orderId, null, { force: true })
  const plan = outcome.planId ? await getPlan(svc, outcome.planId) : null
  res.json({ outcome: outcome.result, reason: outcome.reason, plan: plan ? (await planDtos(req.scope, [plan]))[0] : null })
}
