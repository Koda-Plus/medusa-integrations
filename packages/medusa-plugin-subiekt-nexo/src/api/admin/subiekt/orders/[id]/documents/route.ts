import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toTaskDto } from "../../../../../../modules/subiekt/lib/dto"
import { decideDocumentKind } from "../../../../../../modules/subiekt/lib/documents"
import { buyerContext } from "../../../../../../workflows/subiekt/orders"
import { enqueueTask, kickTasks } from "../../../../../../workflows/subiekt/tasks"
import { updateTask } from "../../../../../../workflows/subiekt/queue"
import { subiektService } from "../../../helpers"

/**
 * POST /admin/subiekt/orders/:id/documents  { "kind"?: "fs" | "pa" }
 *
 * "Issue the invoice now" from the order page. A person decided, so the
 * documents writer does not need to be armed, but the option must allow sales
 * documents (`salesDocument` not `none`): the developer's hard switch wins.
 * Without `kind` the option decides (auto: FS with a valid NIP, PA otherwise).
 * Exactly once: one task per order, and the bridge returns an existing
 * document instead of a second one.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const o = svc.getOptions()
  if (!svc.isDemo() && !svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  if (o.salesDocument === "none") {
    res.status(409).json({ message: "Sales documents are off: set the plugin option salesDocument to fs, pa or auto." })
    return
  }
  const ctx = await buyerContext(req.scope, req.params.id)
  if (!ctx) {
    res.status(404).json({ message: "Order not found." })
    return
  }
  if (ctx.canceled) {
    res.status(409).json({ message: "The order is canceled." })
    return
  }
  const asked = (req.body as { kind?: unknown } | undefined)?.kind
  const kind = asked === "fs" || asked === "pa" ? asked : decideDocumentKind(o.salesDocument, ctx.nip)
  if (!kind) {
    res.status(409).json({ message: "No sales document applies to this order." })
    return
  }
  let task = await enqueueTask(req.scope, {
    kind: "order.document",
    orderId: req.params.id,
    displayId: ctx.displayId,
    status: "pending",
    trigger: "manual",
    force: true,
    detail: { kind, nip: ctx.nip },
  })
  // A person may change a kind that never produced a document. Once one exists, the bridge returns it anyway.
  if ((asked === "fs" || asked === "pa") && task.detail?.kind !== asked && task.status !== "succeeded" && task.status !== "running") {
    task = await updateTask(req.scope, task.id, { detail: { ...(task.detail ?? {}), kind: asked } })
  }
  kickTasks(req.scope, "manual")
  res.status(202).json({ task: toTaskDto(task) })
}
