import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { StoreConfigResponse } from "../../../../modules/inpostpay/lib/contract"
import { readSettings } from "../../../../modules/inpostpay/lib/store"
import { optionsOf } from "../../../../workflows/inpostpay/runtime"

/**
 * GET /store/inpostpay/config: what the storefront needs before it shows the
 * button: whether InPost Pay is on, the mode, the public Merchant Client Id
 * and the widget script (none in demo mode), and the places the admin
 * switched on (product page, cart, mini cart, checkout, thank-you page).
 * No secret is ever part of it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const o = optionsOf(req.scope)
  const settings = await readSettings(req.scope)
  const live = o.mode === "live" || o.mode === "sandbox"
  const body: StoreConfigResponse = {
    enabled: o.mode !== "off",
    mode: o.mode,
    demo: o.demo,
    merchant_client_id: live ? o.merchantClientId : null,
    widget_script_url: live ? o.widgetUrl : null,
    placements: settings.placements,
    language: "pl",
  }
  res.setHeader("Cache-Control", "public, max-age=60")
  res.json(body)
}
