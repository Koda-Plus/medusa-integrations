import { model } from "@medusajs/framework/utils"

/**
 * Snapshot of one OLX advert and its link to a product variant.
 *
 * A CACHE OF WHAT OLX SAYS, rebuilt by every sync. Only what the matching and
 * the admin need is stored: no contact data, no location, no images.
 * `variant_id` / `product_id` / `sku` / `product_title` are filled by the
 * matching (denormalized, so the admin lists need no joins). `is_primary`
 * marks the advert that represents its variant (live beats limited beats
 * ended, then the newest id).
 *
 * `stats_*` are the advert's own counters from the statistics endpoint,
 * refreshed by their own job; the sync never touches them.
 */
const OlxAdvert = model
  .define("olx_advert", {
    id: model.id({ prefix: "olxad" }).primaryKey(),
    olx_id: model.text(),
    title: model.text(),
    url: model.text(),
    status: model.text(),
    external_id: model.text().nullable(),
    description_sku: model.text().nullable(),
    match_key: model.text().nullable(),
    match_source: model.text().nullable(),
    variant_id: model.text().nullable(),
    product_id: model.text().nullable(),
    sku: model.text().nullable(),
    product_title: model.text().nullable(),
    is_primary: model.boolean().default(false),
    price: model.json().nullable(),
    valid_to: model.dateTime().nullable(),
    olx_created_at: model.dateTime().nullable(),
    category_id: model.number().nullable(),
    stats_views: model.number().nullable(),
    stats_phone_views: model.number().nullable(),
    stats_observers: model.number().nullable(),
    stats_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["olx_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["variant_id"], where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
  ])

export default OlxAdvert
