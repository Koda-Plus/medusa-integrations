import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canReadCatalog } from "../../../../modules/baselinker/lib/options"
import { runCatalogSync } from "../../../../workflows/baselinker/catalog"
import { isJobRunning } from "../../../../workflows/baselinker/runtime"
import { loadCardLinks, setCardLink } from "../../../../workflows/baselinker/settings"
import { actorOf, baselinkerService, guarded } from "../helpers"

/**
 * Manual card links: a person pairs a BaseLinker card with a Medusa variant
 * when they share no SKU or EAN (see lib/matching.ts). Kept in the plugin
 * settings, on the Medusa side only: NOTHING is written to BaseLinker.
 *
 * GET  /admin/baselinker/links                     { links: { [blProductId]: variantId } }
 * POST /admin/baselinker/links { bl_product_id, variant_id | null }
 *
 * After a change the catalog is matched again in the background (the same
 * run as "Sync cards"), so the table shows the new pair in a moment.
 */
export const GET = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const links = await loadCardLinks(baselinkerService(req.scope))
  res.json({ links: Object.fromEntries(links) })
})

export const POST = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const body = (req.body ?? {}) as { bl_product_id?: unknown; variant_id?: unknown }
  const card = typeof body.bl_product_id === "string" || typeof body.bl_product_id === "number" ? String(body.bl_product_id).trim() : ""
  const variant = body.variant_id === null ? null : typeof body.variant_id === "string" ? body.variant_id.trim() : undefined
  if (!/^\d{1,20}$/.test(card) || variant === undefined || (variant !== null && !/^variant_[A-Za-z0-9]+$/.test(variant))) {
    res.status(400).json({ message: "`bl_product_id` must be a card number and `variant_id` a variant id or null." })
    return
  }
  const links = await setCardLink(svc, card, variant, await actorOf(req))

  let rematch = false
  if (canReadCatalog(svc.getOptions()) && !(await isJobRunning(req.scope, "catalog"))) {
    rematch = true
    setImmediate(() => {
      void runCatalogSync(req.scope, { trigger: "manual" }).catch((err: unknown) => {
        svc.getLogger().error(`[baselinker] relink: ${svc.mask((err as Error)?.message ?? String(err))}`)
      })
    })
  }
  res.json({ links: Object.fromEntries(links), rematch })
})
