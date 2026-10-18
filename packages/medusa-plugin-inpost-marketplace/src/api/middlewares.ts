import { defineMiddlewares } from "@medusajs/framework/http"
import { DEMO_ORDER_MARKER, MARKETPLACE_REF_KEY } from "../modules/vonhalsky/lib/constants"
import { STORE_METADATA_MATCHERS, reservedMetadataGuard, writeGuard } from "../modules/vonhalsky/lib/kit-guards"

/**
 * - Writes to /admin/vonhalsky come from the admin or a server, never from a
 *   form on another site: JSON or the x-koda-request header, which a
 *   cross-site form cannot send.
 * - A shopper may not put the plugin's order keys on a cart or the account:
 *   `vonhalsky_*`, the marketplace reference the importers share and the
 *   demo marker. Medusa copies cart metadata to the order, and these keys
 *   mean "a marketplace order" to other systems. The plugin itself never
 *   trusts them: its own order table is the record.
 *
 * When this plugin's code is copied into an app, this file becomes
 * `src/api/vonhalsky-middlewares.ts`: spread its `routes` into the app's own
 * `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [
    { matcher: "/admin/vonhalsky*", middlewares: [writeGuard()] },
    ...STORE_METADATA_MATCHERS.map((matcher) => ({ matcher, middlewares: [reservedMetadataGuard(["vonhalsky_"], [MARKETPLACE_REF_KEY, DEMO_ORDER_MARKER])] })),
  ],
})
