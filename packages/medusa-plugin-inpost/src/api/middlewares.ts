import { defineMiddlewares, type MedusaNextFunction, type MedusaRequest, type MedusaResponse } from "@medusajs/framework/http"
import { STORE_METADATA_MATCHERS, reservedMetadataGuard, writeGuard } from "../modules/inpost/lib/kit-guards"
import { inpostService } from "../workflows/inpost/runtime"

/**
 * Writes to /admin/inpost come from the admin or a server, never from a form
 * on another site (labels, offers and courier pickups cost money).
 *
 * A shopper may not set `inpost_*` metadata on a cart or the account, nor
 * the keys of `skipMetadataKeys` (they would stop the shipment of the order
 * or make the plugin track another parcel): those keys are written by the
 * store's own systems through the admin API.
 */
function storeMetadataGuard(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  let keys: string[] = []
  try {
    keys = inpostService(req.scope).getOptions().skipMetadataKeys
  } catch {
    keys = []
  }
  reservedMetadataGuard(["inpost_"], keys)(req, res, next)
}

export default defineMiddlewares({
  routes: [
    { matcher: "/admin/inpost*", middlewares: [writeGuard()] },
    ...STORE_METADATA_MATCHERS.map((matcher) => ({ matcher, middlewares: [storeMetadataGuard] })),
  ],
})
