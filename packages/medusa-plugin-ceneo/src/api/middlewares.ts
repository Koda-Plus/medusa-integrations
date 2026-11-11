import { defineMiddlewares } from "@medusajs/framework/http"
import { writeGuard } from "../modules/ceneo/lib/kit-guards"

/**
 * Admin writes of this plugin need JSON or the `x-koda-request` header
 * (kit writeGuard), so a cross-site form cannot trigger them.
 *
 * When this plugin's code is copied into an app (the Koda Plus demo), this
 * file becomes `src/api/ceneo-middlewares.ts`: spread its `routes` into the
 * app's own `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [{ matcher: "/admin/ceneo*", middlewares: [writeGuard()] }],
})
