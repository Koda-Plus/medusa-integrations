import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { StatusResponse } from "../../../../modules/baselinker/lib/contract"
import { runCatalogSync } from "../../../../workflows/baselinker/catalog"
import { readSetting, writeSetting } from "../../../../workflows/baselinker/settings"
import { actorOf, baselinkerService, buildStatus, guarded } from "../helpers"

/**
 * POST /admin/baselinker/directions  { "catalog"?: "medusa" | "baselinker", "stock"?: "baselinker" | "medusa" }
 *
 * DEMO MODE ONLY: lets a visitor look at both directions of the simulation.
 * On a real account the source of truth is a decision made in the plugin
 * options (`catalogSource`, `stockSource`), deployed like any other setting,
 * never a click; this route refuses it. A new pick plans again right away.
 */
export const POST = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  if (!svc.isDemo()) {
    res.status(409).json({ message: "Directions are set in the plugin options (catalogSource, stockSource) on a real account." })
    return
  }
  const body = (req.body ?? {}) as { catalog?: unknown; stock?: unknown }
  const current = (await readSetting<{ catalog?: string; stock?: string }>(svc, "directions")) ?? {}
  const next = {
    catalog: body.catalog === "medusa" || body.catalog === "baselinker" ? body.catalog : current.catalog,
    stock: body.stock === "medusa" || body.stock === "baselinker" ? body.stock : current.stock,
  }
  await writeSetting(svc, "directions", next, await actorOf(req))
  setImmediate(() => {
    runCatalogSync(req.scope, { trigger: "manual" }).catch((err: unknown) => {
      svc.getLogger().error(`[baselinker] plan after a direction change: ${svc.mask((err as Error)?.message ?? String(err))}`)
    })
  })
  const status: StatusResponse = await buildStatus(svc)
  res.json(status)
})
