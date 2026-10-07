import { defineMiddlewares, type MedusaNextFunction, type MedusaRequest, type MedusaResponse } from "@medusajs/framework/http"
import { DEFAULT_SKIP_ORDER_METADATA_KEYS } from "../modules/emails/lib/constants"
import { STORE_METADATA_MATCHERS, reservedMetadataGuard, writeGuard } from "../modules/emails/lib/kit-guards"
import { emailsService } from "../workflows/emails/runtime"

/**
 * Writes to /admin/emails (settings, test sends, retries, the demo seed)
 * come from the admin or a server, never from a form on another site:
 * Medusa's session cookie is `SameSite=None` in production, so a form could
 * otherwise post with it (a test send or a retry e-mails a customer).
 *
 * A shopper may not set the keys of `skipOrderMetadataKeys` on a cart or
 * the account through the Store API: Medusa copies cart metadata to the
 * order, and an order with such a key gets no e-mail (a marketplace already
 * wrote to the buyer). Those keys are written by the store's own systems
 * (the marketplace imports) through the admin API. The language keys
 * (`locale`, `language`) stay open: that is the shopper's own choice.
 */
function storeMetadataGuard(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void {
  let keys: string[] = [...DEFAULT_SKIP_ORDER_METADATA_KEYS]
  try {
    keys = emailsService(req.scope).getOptions().skipOrderMetadataKeys
  } catch {
    /* the defaults */
  }
  reservedMetadataGuard([], keys)(req, res, next)
}

export default defineMiddlewares({
  routes: [
    { matcher: "/admin/emails*", middlewares: [writeGuard()] },
    ...STORE_METADATA_MATCHERS.map((matcher) => ({ matcher, middlewares: [storeMetadataGuard] })),
  ],
})
