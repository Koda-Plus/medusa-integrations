import { authenticate, defineMiddlewares } from "@medusajs/framework/http"

/**
 * The Store API of this plugin (`/store/negotiations/...`) serves the
 * LOGGED-IN customer only: a customer session or a customer bearer token,
 * nothing else. The routes check the actor again and compare the thread's
 * customer, so a missing middleware never opens them. Bodies are small
 * (messages of a few kilobytes), so the parser takes at most 64 KB.
 *
 * When this plugin's code is copied into an app (the Koda Plus demo), this
 * file becomes `src/api/negotiations-middlewares.ts`: spread its `routes`
 * into the app's own `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/negotiations*",
      bodyParser: { sizeLimit: "64kb" },
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
  ],
})
