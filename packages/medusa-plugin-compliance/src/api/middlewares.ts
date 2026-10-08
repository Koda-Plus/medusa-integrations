import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

/**
 * The Store API of this plugin. The GPSR product route and the consent route
 * are public (the GPSR offer must be visible to everyone, and a visitor
 * gives consent before logging in); the data subject request routes serve
 * the LOGGED-IN customer only, so their requests stay their own.
 *
 * When this plugin's code is copied into an app (the Koda Plus demo), this
 * file becomes `src/api/compliance-middlewares.ts`: spread its `routes` into
 * the app's own `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/compliance/dsr*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
  ],
})
