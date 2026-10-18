import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { bindCart } from "../../../../workflows/inpostpay/baskets"
import { optionsOf } from "../../../../workflows/inpostpay/runtime"
import { limited, storeFail } from "../../../inpostpay/store-helpers"

/**
 * POST /store/inpostpay/baskets { cart_id, binding_place? }: the button.
 * Binds the cart to InPost Pay and answers the basket and, in sandbox and
 * live, what `InPostPayWidget.init` needs (`basketBindingApiKey`, the
 * Merchant Client Id, the script). Demo mode answers `widget: null`: the
 * storefront shows its own demo button and calls demo-confirm.
 *
 * Public with Medusa's publishable key; at most 30 bindings per client IP in
 * 10 minutes. Polite while the plugin is not configured (`enabled: false`).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const body = (req.body ?? {}) as { cart_id?: unknown; binding_place?: unknown }
  const cartId = typeof body.cart_id === "string" ? body.cart_id.trim() : ""
  if (!/^cart_[A-Za-z0-9]+$/.test(cartId)) {
    res.status(400).json({ code: "CART_ID_INVALID", message: "Send the cart_id of the cart." })
    return
  }
  if (limited(req, res, "bind")) return
  if (optionsOf(req.scope).mode === "off") {
    res.json({ enabled: false, code: "NOT_CONFIGURED", message: "InPost Pay is not available in this store yet." })
    return
  }
  try {
    res.json(await bindCart(req.scope, { cartId, bindingPlace: typeof body.binding_place === "string" ? body.binding_place : null }))
  } catch (e) {
    storeFail(req, res, e)
  }
}
