import { defineMiddlewares } from "@medusajs/framework/http"
import { STORE_METADATA_MATCHERS, reservedMetadataGuard, writeGuard } from "../modules/dpd/lib/kit-guards"

/**
 * Writes to /admin/dpd come from the admin or a server, never from a form on
 * another site (the writers decide what is sent to DPD, and labels and
 * courier orders cost money).
 *
 * A shopper may not set `dpd_*` metadata on a cart or the account: the
 * plugin reads its facts from its own tables and the provider's method data,
 * and keeps the prefix for the store's own systems (admin API).
 */
export default defineMiddlewares({
  routes: [
    { matcher: "/admin/dpd*", middlewares: [writeGuard()] },
    ...STORE_METADATA_MATCHERS.map((matcher) => ({ matcher, middlewares: [reservedMetadataGuard(["dpd_"])] })),
  ],
})
