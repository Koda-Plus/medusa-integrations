import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

/**
 * The Store API of this plugin serves the LOGGED-IN customer only: their own
 * counterparty status, from their own company NIP. A public NIP checker would
 * be a free registry proxy, so the routes are closed.
 *
 * When this plugin's code is copied into an app (the Koda Plus demo), this
 * file becomes `src/api/whitelist-middlewares.ts`: spread its `routes` into
 * the app's own `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/whitelist*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
  ],
})
