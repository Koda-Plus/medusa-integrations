import { defineMiddlewares } from "@medusajs/framework/http"
import { writeGuard } from "../modules/coupons/lib/kit-guards"

/**
 * Writes to /admin/coupons (a new coupon, a pause) come from the admin or a
 * server, never from a form on another site: Medusa's session cookie is
 * SameSite=None in production. No store routes, no metadata guard: the
 * plugin reads nothing from carts or orders that a shopper could set.
 */
export default defineMiddlewares({
  routes: [{ matcher: "/admin/coupons*", middlewares: [writeGuard()] }],
})
