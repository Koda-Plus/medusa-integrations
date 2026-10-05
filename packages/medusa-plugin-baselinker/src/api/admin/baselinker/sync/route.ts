import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SyncResponse } from "../../../../modules/baselinker/lib/contract"
import { canExportOrders, canReadCatalog, canReadStatuses } from "../../../../modules/baselinker/lib/options"
import { runCatalogSync } from "../../../../workflows/baselinker/catalog"
import { sendDueOrders } from "../../../../workflows/baselinker/orders"
import { isRunning } from "../../../../workflows/baselinker/runtime"
import { syncStatuses } from "../../../../workflows/baselinker/statuses"
import { baselinkerService } from "../helpers"

type What = SyncResponse["what"]

const WHAT: readonly What[] = ["catalog", "statuses", "orders"]

/**
 * POST /admin/baselinker/sync  { "what": "catalog" | "statuses" | "orders" }
 *
 * Runs the same code as the scheduled job, now. Answers 202 right away and
 * works in the background; the admin polls GET /admin/baselinker while the
 * kind is listed in `running`.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const svc = baselinkerService(req.scope)
  const o = svc.getOptions()
  const mode = o.demo ? "demo" : "live"
  const what = String((req.body as { what?: unknown } | undefined)?.what ?? "") as What
  if (!WHAT.includes(what)) {
    res.status(400).json({ message: "`what` must be one of: catalog, statuses, orders." })
    return
  }
  const ready = what === "catalog" ? canReadCatalog(o) : what === "orders" ? canExportOrders(o) : canReadStatuses(o)
  if (!ready) {
    const missing = svc.missingOptions()
    res.status(409).json({
      message:
        what === "orders" && !o.exportOrders
          ? "Order export is off (exportOrders: false)."
          : `Missing plugin options: ${missing.length > 0 ? missing.join(", ") : "apiToken"}.`,
    })
    return
  }
  if (isRunning(what)) {
    const body: SyncResponse = { started: false, alreadyRunning: true, mode, what }
    res.status(202).json(body)
    return
  }

  const run: () => Promise<unknown> =
    what === "catalog"
      ? () => runCatalogSync(req.scope, { trigger: "manual" })
      : what === "orders"
        ? () => sendDueOrders(req.scope, "manual")
        : () => syncStatuses(req.scope, "manual")
  setImmediate(() => {
    void Promise.resolve()
      .then(run)
      .catch((err: unknown) => {
        svc.getLogger().error(`[baselinker] manual ${what}: ${svc.mask((err as Error)?.message ?? String(err))}`)
      })
  })
  const body: SyncResponse = { started: true, alreadyRunning: false, mode, what }
  res.status(202).json(body)
}
