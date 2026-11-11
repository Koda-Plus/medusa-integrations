import { defineMiddlewares } from "@medusajs/framework/http"
import { RESERVED_METADATA_PREFIXES } from "../modules/ceneo/lib/constants"
import { STORE_METADATA_MATCHERS, reservedMetadataGuard, writeGuard } from "../modules/ceneo/lib/kit-guards"

/**
 * Admin writes of this plugin, and the storefront's consent write, need
 * JSON or the `x-koda-request` header (kit writeGuard), so a cross-site
 * form cannot trigger them. The store routes that take shopper metadata
 * refuse `ceneo_*` keys: the plugin's tables are the record, a shopper
 * never writes its state.
 *
 * When this plugin's code is copied into an app (the Koda Plus demo), this
 * file becomes `src/api/ceneo-middlewares.ts`: spread its `routes` into the
 * app's own `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [
    { matcher: "/admin/ceneo*", middlewares: [writeGuard()] },
    { matcher: "/store/ceneo*", middlewares: [writeGuard()] },
    ...STORE_METADATA_MATCHERS.map((matcher) => ({
      matcher,
      middlewares: [reservedMetadataGuard(RESERVED_METADATA_PREFIXES)],
    })),
  ],
})
