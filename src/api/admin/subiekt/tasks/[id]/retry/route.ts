import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { toTaskDto, type TaskRow } from "../../../../../../modules/subiekt/lib/dto"
import { enqueueTask, kickTasks } from "../../../../../../workflows/subiekt/tasks"
import { subiektService } from "../../../helpers"

/**
 * POST /admin/subiekt/tasks/:id/retry
 *
 * Sends a task again now: attempts reset, error cleared, a pass started.
 * Safe for a ZK that may already exist, because the bridge is idempotent per
 * order and answers with the existing document.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const rows = (await svc.listSubiektTasks({ id: req.params.id } as never, { take: 1 } as never)) as unknown as TaskRow[]
  const task = rows[0]
  if (!task) {
    res.status(404).json({ message: "Task not found." })
    return
  }
  if (task.status === "running") {
    res.status(409).json({ message: "The task is being sent right now." })
    return
  }
  if (!svc.isDemo() && !svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  const updated = await enqueueTask(req.scope, {
    kind: task.kind as "order.create",
    orderId: task.order_id,
    displayId: task.display_id,
    reference: task.reference,
    status: "pending",
    trigger: "manual",
    force: true,
  })
  kickTasks(req.scope, "manual")
  res.status(202).json({ task: toTaskDto(updated) })
}
