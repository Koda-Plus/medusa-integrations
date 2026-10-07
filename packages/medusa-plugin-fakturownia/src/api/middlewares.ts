import { authenticate, defineMiddlewares, type MiddlewareRoute } from "@medusajs/framework/http"
import { FeatureFlag } from "@medusajs/framework/utils"
import { writeGuard } from "../modules/fakturownia/lib/kit-guards"
import { POLICY } from "../modules/fakturownia/lib/policies"

/**
 * STORE: the storefront routes of this plugin (`/store/fakturownia/...`)
 * serve the documents of the LOGGED-IN customer only: a customer session or a
 * customer bearer token, nothing else. The routes check the actor again and
 * compare the order's customer id, so a missing middleware never opens them.
 * The plugin keeps no state in order or cart metadata, so it guards no
 * metadata keys there: the buyer's NIP a shopper types at checkout is input,
 * validated as data when the document is built.
 *
 * ADMIN: a write to `/admin/fakturownia` comes from the admin or a server,
 * never from a form on another site (`writeGuard`: a JSON body or the
 * `x-koda-request` header; Medusa's session cookie is `SameSite=None` in
 * production). With Medusa's RBAC on, the routes declare their policies
 * (`lib/policies.ts`): reading needs `fakturownia:read`, every write
 * `fakturownia:update`, and approving corrections, e-mailing and sending to
 * KSeF again, and the writers need their own operation as well.
 *
 * The policies are declared only while Medusa's `rbac` feature flag is on.
 * Medusa 2.21 reads them only then; Medusa 2.12 checks declared policies
 * even with RBAC off, which would refuse every admin without a role (401 on
 * every page of the plugin). Without RBAC the routes behave as before it.
 *
 * When this plugin's code is copied into an app (the Koda Plus demo), this
 * file becomes `src/api/fakturownia-middlewares.ts`: spread its `routes` into
 * the app's own `src/api/middlewares.ts`.
 */
/** Whether Medusa's RBAC is on in this process (false where the flag is unknown). */
export function rbacEnabled(): boolean {
  try {
    return FeatureFlag.isFeatureEnabled("rbac") === true
  } catch {
    return false
  }
}

/** The admin routes: the write guard always, the RBAC policies only with RBAC on. */
export function adminRoutes(rbac: boolean): MiddlewareRoute[] {
  if (!rbac) return [{ matcher: "/admin/fakturownia*", middlewares: [writeGuard()] }]
  return [
    { matcher: "/admin/fakturownia*", middlewares: [writeGuard()], policies: [POLICY.read] },
    { matcher: "/admin/fakturownia*", methods: ["POST"], policies: [POLICY.update] },
    { matcher: "/admin/fakturownia/corrections/*/approve", methods: ["POST"], policies: [POLICY.approve] },
    { matcher: "/admin/fakturownia/documents/*/email", methods: ["POST"], policies: [POLICY.send] },
    { matcher: "/admin/fakturownia/documents/*/ksef-resend", methods: ["POST"], policies: [POLICY.send] },
    { matcher: "/admin/fakturownia/writers", methods: ["POST"], policies: [POLICY.manage] },
  ]
}

export default defineMiddlewares({
  routes: [
    {
      matcher: "/store/fakturownia*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    ...adminRoutes(rbacEnabled()),
  ],
})
