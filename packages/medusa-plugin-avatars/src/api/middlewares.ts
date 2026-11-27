import { defineMiddlewares } from "@medusajs/framework/http"
import { writeGuard } from "../modules/avatars/lib/kit-guards"

/**
 * Writes to /admin/avatars (an avatar, a consent, a presentation) come from
 * the admin or a server, never from a form on another site: Medusa's session
 * cookie is SameSite=None in production. The store routes only read
 * published presentations; no metadata guard: the plugin reads nothing from
 * carts or orders.
 */
export default defineMiddlewares({
  routes: [{ matcher: "/admin/avatars*", middlewares: [writeGuard()] }],
})
