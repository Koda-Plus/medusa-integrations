import { defineMiddlewares, type MedusaNextFunction, type MedusaRequest, type MedusaResponse } from "@medusajs/framework/http"
import { RESERVED_METADATA_KEYS, RESERVED_METADATA_PREFIXES } from "../modules/baselinker/lib/constants"
import { STORE_METADATA_MATCHERS, reservedMetadataGuard, writeGuard } from "../modules/baselinker/lib/kit-guards"
import { baselinkerService } from "../workflows/baselinker/runtime"

/**
 * Writes to /admin/baselinker come from the admin or a server, never from a
 * form on another site: arming a writer, sending or importing an order and
 * running a job change real data (415 without a JSON body or the
 * x-koda-request header).
 *
 * A shopper may not set `baselinker_*` metadata, the shared
 * `marketplace_order_ref` or the skip key (`skipOrderMetadataKey`) on a cart
 * or the account: those keys are written by the store's own systems through
 * the admin API. The plugin decides nothing by them anyway (its tables are
 * the record); the guard keeps the noise out.
 */
function storeMetadataGuard(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  let skipKey: string | null = null
  try {
    skipKey = baselinkerService(req.scope).getOptions().skipOrderMetadataKey
  } catch {
    skipKey = null
  }
  reservedMetadataGuard(RESERVED_METADATA_PREFIXES, skipKey ? [...RESERVED_METADATA_KEYS, skipKey] : RESERVED_METADATA_KEYS)(req, res, next)
}

export default defineMiddlewares({
  routes: [
    { matcher: "/admin/baselinker*", middlewares: [writeGuard()] },
    ...STORE_METADATA_MATCHERS.map((matcher) => ({ matcher, middlewares: [storeMetadataGuard] })),
  ],
})
