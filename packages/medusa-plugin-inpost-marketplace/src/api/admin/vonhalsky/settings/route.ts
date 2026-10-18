import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SETTING_KEYS } from "../../../../modules/vonhalsky/lib/constants"
import { parseMarkup } from "../../../../modules/vonhalsky/lib/pricing"
import { normalizeMapping } from "../../../../modules/vonhalsky/lib/shipping"
import { logSync, readSettings, writeSetting } from "../../../../modules/vonhalsky/lib/store"
import { refreshOffers } from "../../../../workflows/vonhalsky/offers"
import { optionsOf } from "../../../../workflows/vonhalsky/runtime"
import { regionsOfStore, salesChannelsOfStore, shippingOptionsOfStore } from "../../../vonhalsky/admin-helpers"

/**
 * GET / POST /admin/vonhalsky/settings:
 *   pricing   { markupPercent }                 the channel markup (-50 to 300); offers are priced again
 *   orders    { salesChannelId, regionId, autoImport }
 *   shipping  { APM, COURIER }                  shipping option ids, or null
 * Ids must exist in the store.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json(await readSettings(req.scope))
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as { pricing?: { markupPercent?: unknown }; orders?: { salesChannelId?: unknown; regionId?: unknown; autoImport?: unknown }; shipping?: unknown }
  const current = await readSettings(req.scope)
  const changed: string[] = []

  if (body.pricing !== undefined) {
    const markup = parseMarkup(body.pricing?.markupPercent)
    if (markup === null) {
      res.status(400).json({ code: "invalid_markup", message: "The markup is a number from -50 to 300 (percent)." })
      return
    }
    await writeSetting(req.scope, SETTING_KEYS.pricing, { markupPercent: markup })
    changed.push(`markup ${markup}%`)
  }

  if (body.orders !== undefined) {
    const o = body.orders ?? {}
    const channel = o.salesChannelId === null || o.salesChannelId === "" ? null : typeof o.salesChannelId === "string" ? o.salesChannelId : current.orders.salesChannelId
    const region = o.regionId === null || o.regionId === "" ? null : typeof o.regionId === "string" ? o.regionId : current.orders.regionId
    if (channel && !(await salesChannelsOfStore(req)).some((c) => c.id === channel)) {
      res.status(400).json({ code: "unknown_sales_channel", message: `Unknown sales channel ${channel}.` })
      return
    }
    if (region) {
      const r = (await regionsOfStore(req)).find((x) => x.id === region)
      if (!r) {
        res.status(400).json({ code: "unknown_region", message: `Unknown region ${region}.` })
        return
      }
      if (r.currency !== "pln") {
        res.status(400).json({ code: "region_not_pln", message: "Marketplace orders are in PLN: pick a PLN region." })
        return
      }
    }
    await writeSetting(req.scope, SETTING_KEYS.orders, { salesChannelId: channel, regionId: region, autoImport: typeof o.autoImport === "boolean" ? o.autoImport : current.orders.autoImport })
    changed.push("orders")
  }

  if (body.shipping !== undefined) {
    const mapping = normalizeMapping(body.shipping)
    const known = new Set((await shippingOptionsOfStore(req)).map((x) => x.id))
    const unknown = Object.values(mapping).filter((id): id is string => typeof id === "string" && !known.has(id))
    if (unknown.length) {
      res.status(400).json({ code: "unknown_shipping_option", message: `Unknown shipping options: ${unknown.join(", ")}` })
      return
    }
    await writeSetting(req.scope, SETTING_KEYS.shipping, mapping)
    changed.push("shipping")
  }

  if (changed.length > 0) await logSync(req.scope, { area: "settings", action: "save", message: `Settings saved: ${changed.join(", ")}.`, demo: optionsOf(req.scope).demo })
  /* A new markup prices every offer again (local only: nothing is listed by this). */
  if (body.pricing !== undefined && optionsOf(req.scope).mode !== "off") await refreshOffers(req.scope).catch(() => undefined)
  res.json(await readSettings(req.scope))
}
