import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { issueOrderNow } from "../../../../../../workflows/fakturownia/documents"
import { fakturowniaService } from "../../../helpers"

const REASONS: Record<string, string> = {
  not_configured: "The plugin is not configured to issue documents.",
  order_not_found: "Order not found.",
  order_canceled: "The order is canceled.",
}

/**
 * POST /admin/fakturownia/orders/:orderId/issue
 *
 * "Issue now" on the order page: the document of the trigger is queued
 * without waiting for the trigger (a proforma in the proforma flow before the
 * first fulfillment, the final document otherwise), and the outbox starts in
 * the background. Answers 202. Safe to click twice: the unique index keeps
 * one row, and the attempt looks the document up in Fakturownia first.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  if (!svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  const result = await issueOrderNow(req.scope, req.params.orderId)
  if (result.reason && result.reason !== "not_due") {
    res.status(result.reason === "order_not_found" ? 404 : 409).json({ message: REASONS[result.reason] ?? result.reason })
    return
  }
  if (result.inserted.length === 0) {
    res.status(409).json({ message: "This order already has that document (see its status on the order page)." })
    return
  }
  res.status(202).json({ queued: result.inserted.map((r) => r.kind) })
}
