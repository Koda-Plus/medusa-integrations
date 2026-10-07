import { defineMiddlewares } from "@medusajs/framework/http"
import { DEMO_ORDER_MARKER, MARKETPLACE_REF_KEY } from "../modules/allegro/lib/constants"
import { STORE_METADATA_MATCHERS, reservedMetadataGuard, writeGuard } from "../modules/allegro/lib/kit-guards"

/**
 * Writes to /admin/allegro come from the admin or a server, never from a form
 * on another site (they arm writers, connect the account and send to
 * Allegro): JSON or the x-koda-request header, which a cross-site form
 * cannot send.
 *
 * A shopper may not put the plugin's own order keys on a cart or the account:
 * `allegro_*`, the marketplace reference the importers share and the demo
 * marker. Medusa copies cart metadata to the order, and these keys mean "an
 * Allegro order" to other systems. The plugin itself never trusts them: its
 * import table is the record.
 */
export default defineMiddlewares({
  routes: [
    { matcher: "/admin/allegro*", middlewares: [writeGuard()] },
    ...STORE_METADATA_MATCHERS.map((matcher) => ({
      matcher,
      middlewares: [reservedMetadataGuard(["allegro_"], [MARKETPLACE_REF_KEY, DEMO_ORDER_MARKER])],
    })),
  ],
})
