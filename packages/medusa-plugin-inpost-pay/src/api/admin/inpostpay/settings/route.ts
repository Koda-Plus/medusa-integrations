import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SETTING_KEYS } from "../../../../modules/inpostpay/lib/constants"
import { normalizeMapping } from "../../../../modules/inpostpay/lib/delivery"
import { normalizePlacements, readSettings, writeSetting } from "../../../../modules/inpostpay/lib/store"
import { shippingOptionsOfStore } from "../../../inpostpay/admin-helpers"

/**
 * GET / POST /admin/inpostpay/settings: the shipping option of each InPost
 * Pay delivery type (`delivery: { APM, COURIER, DIGITAL }`, shipping option
 * ids or null) and the places of the button (`placements`). Mapped ids must
 * be shipping options of the store.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  res.json(await readSettings(req.scope))
}

export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as { delivery?: unknown; placements?: unknown }
  if (body.delivery !== undefined) {
    const mapping = normalizeMapping(body.delivery)
    const known = new Set((await shippingOptionsOfStore(req)).map((o) => o.id))
    const unknown = Object.values(mapping).filter((id): id is string => typeof id === "string" && !known.has(id))
    if (unknown.length) {
      res.status(400).json({ code: "unknown_shipping_option", message: `Unknown shipping options: ${unknown.join(", ")}` })
      return
    }
    await writeSetting(req.scope, SETTING_KEYS.delivery, mapping)
  }
  if (body.placements !== undefined) await writeSetting(req.scope, SETTING_KEYS.placements, normalizePlacements(body.placements))
  res.json(await readSettings(req.scope))
}
