import { defineMiddlewares } from "@medusajs/framework/http"
import { writeGuard } from "../modules/railway/lib/kit-guards"

/**
 * Every route under /admin/railway only reads (GET). The write guard still
 * stands in front of them, so a write added later can only come from the
 * admin or a server (a JSON body or the x-koda-request header), never from a
 * form on another site.
 *
 * No store routes and no metadata guard: the plugin reads nothing from
 * orders or carts.
 */
export default defineMiddlewares({
  routes: [{ matcher: "/admin/railway*", middlewares: [writeGuard()] }],
})
