import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { CATALOG_CHANGED_EVENT } from "../modules/ceneo/lib/constants"
import { markCatalogChanged } from "../modules/ceneo/lib/schedule"

/**
 * A product or variant changed: the feed job builds within 5 to 10 minutes
 * instead of waiting for the interval. Only a timestamp in memory, so a
 * batch of edits gives one build. Price and stock changes come with the
 * interval build. `ceneo.catalog-changed` comes from the admin routes
 * (a mapping, a moved id), so a separate worker hears them too.
 */
export default async function ceneoCatalogChanged(_args: SubscriberArgs<unknown>): Promise<void> {
  markCatalogChanged()
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated", "product.deleted", "product-variant.created", "product-variant.updated", "product-variant.deleted", CATALOG_CHANGED_EVENT],
}
