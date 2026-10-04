import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toTaskDto } from "../../../../../../modules/subiekt/lib/dto"
import { queryOf } from "../../../../../../workflows/subiekt/runtime"
import { enqueueTask, kickTasks } from "../../../../../../workflows/subiekt/tasks"
import { subiektService } from "../../../helpers"

/**
 * POST /admin/subiekt/orders/:id/send
 *
 * "Send to Subiekt" from the order page: queues the ZK now, even when the
 * payment is not captured (a person decided). Idempotent on the bridge side.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  if (!svc.isDemo() && !svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  const { data } = await queryOf(req.scope).graph({ entity: "order", fields: ["id", "display_id", "status"], filters: { id: req.params.id } })
  const order = data[0] as { id: string; display_id?: number | null; status?: string } | undefined
  if (!order) {
    res.status(404).json({ message: "Order not found." })
    return
  }
  if (order.status === "canceled") {
    res.status(409).json({ message: "The order is canceled." })
    return
  }
  const task = await enqueueTask(req.scope, {
    kind: "order.create",
    orderId: order.id,
    displayId: order.display_id ?? null,
    status: "pending",
    trigger: "manual",
    force: true,
  })
  kickTasks(req.scope, "manual")
  res.status(202).json({ task: toTaskDto(task) })
}
