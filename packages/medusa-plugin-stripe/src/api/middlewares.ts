import { defineMiddlewares } from "@medusajs/framework/http"
import { writeGuard } from "../modules/stripe/lib/kit-guards"

/**
 * Every route under /admin/stripe only reads today. The write guard still
 * stands in front of them, so a write added later can only come from the
 * admin or a server (a JSON body or the x-koda-request header), never from a
 * form on another site: Medusa's session cookie is SameSite=None in
 * production.
 *
 * No store metadata guard: the plugin reads nothing from order or cart
 * metadata. A payment's order comes from Medusa's payment session, and the
 * session id from the PaymentIntent the official provider created.
 */
export default defineMiddlewares({
  routes: [{ matcher: "/admin/stripe*", middlewares: [writeGuard()] }],
})
