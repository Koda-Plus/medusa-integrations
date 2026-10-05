import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

/**
 * The storefront routes of this plugin (`/store/fakturownia/...`) serve the
 * documents of the LOGGED-IN customer only: a customer session or a customer
 * bearer token, nothing else. The routes check the actor again and compare
 * the order's customer id, so a missing middleware never opens them.
 *
 * When this plugin's code is copied into an app (the Koda Plus demo), this
 * file becomes `src/api/fakturownia-middlewares.ts`: spread its `routes` into
 * the app's own `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/fakturownia*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
  ],
})
