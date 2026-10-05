import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { OrderDocumentsResponse } from "../../../../../modules/fakturownia/lib/contract"
import { manualKind } from "../../../../../modules/fakturownia/lib/document"
import { orderFacts } from "../../../../../workflows/fakturownia/documents"
import { documentsOfOrder, loadOrder } from "../../../../../workflows/fakturownia/runtime"
import { refreshDemoStatuses } from "../../../../../workflows/fakturownia/statuses"
import { documentDto, fakturowniaService } from "../../helpers"

/**
 * GET /admin/fakturownia/orders/:orderId
 *
 * The documents of one order, for the order page widget, and whether
 * "Issue now" makes sense (configured, the order is not canceled, and the
 * document it would issue is not there yet).
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = fakturowniaService(req.scope)
  const o = svc.getOptions()
  await refreshDemoStatuses(req.scope)
  const rows = await documentsOfOrder(svc, req.params.orderId)
  let canIssue = false
  let nextKind: OrderDocumentsResponse["nextKind"] = null
  if (svc.isConfigured()) {
    const order = await loadOrder(req.scope, req.params.orderId).catch(() => null)
    if (order) {
      const facts = orderFacts(order, o)
      nextKind = manualKind({ flow: o.documentFlow, fulfilled: facts.fulfilled, finalKind: facts.finalKind })
      const hasFinal = rows.some((r) => r.kind === "vat" || r.kind === "receipt")
      canIssue = !facts.canceled && !rows.some((r) => r.kind === nextKind) && !(nextKind === "proforma" && hasFinal)
    }
  }
  const body: OrderDocumentsResponse = {
    mode: o.demo ? "demo" : "live",
    configured: svc.isConfigured(),
    canIssue,
    nextKind,
    waitingFor: svc.isConfigured() ? o.trigger : null,
    documents: rows.map((r) => documentDto(svc, r)),
  }
  res.json(body)
}
