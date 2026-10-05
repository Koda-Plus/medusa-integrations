import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ActionResponse, RunKind } from "../../../../modules/subiekt/lib/contract"
import { pullEvents } from "../../../../workflows/subiekt/events"
import { isRunning } from "../../../../workflows/subiekt/runtime"
import { runStockSync } from "../../../../workflows/subiekt/sync-subiekt-stock"
import { runProductSync } from "../../../../workflows/subiekt/sync-subiekt-products"
import { runDueTasks } from "../../../../workflows/subiekt/tasks"
import { subiektService } from "../helpers"

const ACTIONS: Record<string, RunKind> = { stock: "stock", events: "events", tasks: "tasks", products: "products" }

/**
 * POST /admin/subiekt/sync  { "what": "stock" | "events" | "tasks" | "products" }
 *
 * Runs the same code as the scheduled job, now. Answers 202 right away and
 * works in the background; the admin polls GET /admin/subiekt while the kind
 * is listed in `running`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = subiektService(req.scope)
  const mode = svc.isDemo() ? "demo" : "live"
  const what = String((req.body as { what?: unknown } | undefined)?.what ?? "")
  const kind = ACTIONS[what]
  if (!kind) {
    res.status(400).json({ message: "`what` must be one of: stock, events, tasks, products." })
    return
  }
  if (mode === "live" && !svc.isConfigured()) {
    res.status(409).json({ message: `Missing plugin options: ${svc.missingOptions().join(", ")}.` })
    return
  }
  if (isRunning(kind)) {
    const body: ActionResponse = { started: false, alreadyRunning: true, mode }
    res.status(202).json(body)
    return
  }

  const runs: Record<RunKind, () => Promise<unknown>> = {
    stock: () => runStockSync(req.scope, "manual"),
    events: () => pullEvents(req.scope, "manual"),
    tasks: () => runDueTasks(req.scope, "manual"),
    products: () => runProductSync(req.scope, "manual"),
    health: () => Promise.resolve(null),
  }
  const run = runs[kind]
  setImmediate(() => {
    run().catch((err: unknown) => {
      svc.getLogger().error(`[subiekt] Manual ${kind}: ${svc.mask((err as Error)?.message ?? String(err))}`)
    })
  })
  const body: ActionResponse = { started: true, alreadyRunning: false, mode }
  res.status(202).json(body)
}
