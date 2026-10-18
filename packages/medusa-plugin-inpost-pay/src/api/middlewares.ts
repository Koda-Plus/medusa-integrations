import { defineMiddlewares } from "@medusajs/framework/http"
import { STORE_METADATA_MATCHERS, reservedMetadataGuard, writeGuard } from "../modules/inpostpay/lib/kit-guards"

/**
 * - Writes to /admin/inpostpay come from the admin or a server, never from a
 *   form on another site.
 * - The Merchant Backend API (/inpostpay/v1/izi/...) keeps the raw body:
 *   InPost signs the exact bytes, and the signature is checked against them.
 * - A shopper may not set `inpostpay_` or `inpost_pay_` metadata on a cart or
 *   the account: the plugin's own table is the record, the guard keeps the
 *   noise out.
 *
 * When this plugin's code is copied into an app, this file becomes
 * `src/api/inpostpay-middlewares.ts`: spread its `routes` into the app's own
 * `src/api/middlewares.ts`.
 */
export default defineMiddlewares({
  routes: [
    { matcher: "/admin/inpostpay*", middlewares: [writeGuard()] },
    { matcher: "/inpostpay/v1/izi*", bodyParser: { preserveRawBody: true } },
    ...STORE_METADATA_MATCHERS.map((matcher) => ({ matcher, middlewares: [reservedMetadataGuard(["inpostpay_", "inpost_pay_"])] })),
  ],
})
