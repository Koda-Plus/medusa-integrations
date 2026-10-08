import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

/**
 * The Store API of this plugin serves the LOGGED-IN customer only: their own
 * points and their own redemptions.
 *
 * When this plugin's code is copied into an app (the Koda Plus demo), this
 * file becomes `src/api/loyalty-middlewares.ts`: spread its `routes` into
 * the app's own `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/loyalty*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
  ],
})
