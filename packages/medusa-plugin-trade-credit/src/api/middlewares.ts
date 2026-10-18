import { authenticate, defineMiddlewares } from "@medusajs/framework/http"
import { writeGuard } from "../modules/credit/lib/kit-guards"
import { creditHoldMiddleware } from "./credit/hold"

/**
 * The Store API of this plugin serves the LOGGED-IN customer only: their own
 * limit, their own credit orders. With `enforce: true` the cart completion
 * answers 403 `credit_hold` for a customer who is blocked, paused or would
 * pass the limit with the order (./credit/hold.ts).
 *
 * When this plugin's code is copied into an app (the Koda Plus demo), this
 * file becomes `src/api/credit-middlewares.ts`: spread its `routes` into the
 * app's own `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [
    /* A write to the credit admin comes from the admin (JSON or the kit header), never from a form on another site. */
    { matcher: "/admin/credit*", middlewares: [writeGuard()] },
    /* enforce: true. The check passes untouched when the option is off. */
    { matcher: "/store/carts/:id/complete", method: ["POST"], middlewares: [creditHoldMiddleware] },
    {
      matcher: "/store/credit*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
  ],
})
