import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

/**
 * The Store API of this plugin serves the LOGGED-IN customer (their own
 * counterparty status) and one public route: the preview the registration
 * form uses to pull a company card from the NIP before sign-up. The preview
 * is rate limited per address, and in demo mode it answers with simulated
 * data, so the public demo never becomes a free registry proxy.
 *
 * When this plugin's code is copied into an app (the Koda Plus demo), this
 * file becomes `src/api/whitelist-middlewares.ts`: spread its `routes` into
 * the app's own `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/whitelist*",
      middlewares: [authenticate("customer", ["session", "bearer"], { allowUnauthenticated: true })],
    },
  ],
})
