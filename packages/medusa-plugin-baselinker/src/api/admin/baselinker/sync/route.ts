import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { SyncResponse, SyncWhat } from "../../../../modules/baselinker/lib/contract"
import { canExportOrders, canImportOrders, canReadCatalog, canReadReturns, canReadStatuses, canWriteInvoiceNumbers } from "../../../../modules/baselinker/lib/options"
import { runCatalogSync } from "../../../../workflows/baselinker/catalog"
import { processDueInvoices } from "../../../../workflows/baselinker/invoices"
import { runStatusPass } from "../../../../workflows/baselinker/journal"
import { importRules, runOrderImport } from "../../../../workflows/baselinker/order-import"
import { sendDueOrders } from "../../../../workflows/baselinker/orders"
import { syncReturns } from "../../../../workflows/baselinker/returns"
import { isJobRunning, type JobKind } from "../../../../workflows/baselinker/runtime"
import { baselinkerService, guarded } from "../helpers"

const WHAT: readonly SyncWhat[] = ["catalog", "statuses", "orders", "imports", "returns", "invoices"]

/**
 * POST /admin/baselinker/sync  { "what": "catalog" | "statuses" | "orders" | "imports" | "returns" | "invoices" }
 *
 * Runs the same code as the scheduled job, now. Answers 202 right away and
 * works in the background, holding the same lease as the job, so a click
 * never runs next to the job in the worker; the admin polls
 * GET /admin/baselinker/running while the kind is listed. `catalog` reads the cards and makes every plan
 * (an armed writer applies its plan in the same run); `statuses` reads every
 * followed order, sent and imported, the full way.
 */
export const POST = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const o = svc.getOptions()
  const mode = o.demo ? "demo" : "live"
  const what = String((req.body as { what?: unknown } | undefined)?.what ?? "") as SyncWhat
  if (!WHAT.includes(what)) {
    res.status(400).json({ message: `\`what\` must be one of: ${WHAT.join(", ")}.` })
    return
  }
  const ready: Record<SyncWhat, boolean> = {
    catalog: canReadCatalog(o),
    orders: canExportOrders(o),
    statuses: canReadStatuses(o),
    imports: canImportOrders(o) && importRules(o).length > 0,
    returns: canReadReturns(o),
    invoices: canWriteInvoiceNumbers(o),
  }
  if (!ready[what]) {
    const missing = svc.missingOptions()
    res.status(409).json({
      message:
        what === "orders" && !o.exportOrders
          ? "Order export is off (exportOrders: false)."
          : what === "imports"
            ? "Set orderImportSources (and the token) to import marketplace orders."
            : what === "returns" && !o.returnsSync
              ? "Returns are off (returnsSync: false)."
              : `Missing plugin options: ${missing.length > 0 ? missing.join(", ") : "apiToken"}.`,
    })
    return
  }
  const job: JobKind = what === "imports" ? "imports" : what
  if (await isJobRunning(req.scope, job)) {
    const body: SyncResponse = { started: false, alreadyRunning: true, mode, what }
    res.status(202).json(body)
    return
  }

  const runs: Record<SyncWhat, () => Promise<unknown>> = {
    catalog: () => runCatalogSync(req.scope, { trigger: "manual" }),
    orders: () => sendDueOrders(req.scope, "manual"),
    statuses: () => runStatusPass(req.scope, "manual", { full: true }),
    imports: () => runOrderImport(req.scope, "manual"),
    returns: () => syncReturns(req.scope, "manual"),
    invoices: () => processDueInvoices(req.scope, "manual"),
  }
  setImmediate(() => {
    void Promise.resolve()
      .then(runs[what])
      .catch((err: unknown) => {
        svc.getLogger().error(`[baselinker] manual ${what}: ${svc.mask((err as Error)?.message ?? String(err))}`)
      })
  })
  const body: SyncResponse = { started: true, alreadyRunning: false, mode, what }
  res.status(202).json(body)
})
