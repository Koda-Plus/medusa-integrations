import { defineMiddlewares } from "@medusajs/framework/http"
import { writeGuard } from "../modules/kit/lib/kit-guards"

/**
 * Every route under /admin/kit writes the settings: the write guard stands in
 * front of them, so a write can only come from the admin or a server (a JSON
 * body or the x-koda-request header), never from a form on another site.
 *
 * The store subscribe route (POST /store/kit/subscribe) is public and does
 * its own rate limiting; Medusa's store auth does not apply to it.
 *
 * When this plugin's code is copied into an app, this file becomes
 * `src/api/kit-middlewares.ts`: spread its `routes` into the app's own
 * `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [{ matcher: "/admin/kit*", middlewares: [writeGuard()] }],
})
