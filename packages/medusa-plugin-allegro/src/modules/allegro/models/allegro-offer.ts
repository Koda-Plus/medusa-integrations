import { model } from "@medusajs/framework/utils"

/**
 * Snapshot of one Allegro offer, its link to a product variant and the result
 * of the stock check.
 *
 * A CACHE OF WHAT ALLEGRO SAYS, rebuilt by every sync. Only what the
 * matching, the stock check and the admin need is stored: no images, no
 * descriptions, no parameters. `variant_id` / `product_id` / `sku` /
 * `product_title` are filled by the matching (denormalized, so the admin
 * lists need no joins). `is_primary` marks the offer that represents its
 * variant. `medusa_available` and `stock_state` are filled for primary offers
 * by the stock check of the same run.
 */
const AllegroOffer = model
  .define("allegro_offer", {
    id: model.id({ prefix: "algof" }).primaryKey(),
    allegro_id: model.text(),
    name: model.text(),
    status: model.text(),
    external_id: model.text().nullable(),
    match_key: model.text().nullable(),
    variant_id: model.text().nullable(),
    product_id: model.text().nullable(),
    sku: model.text().nullable(),
    product_title: model.text().nullable(),
    is_primary: model.boolean().default(false),
    price: model.json().nullable(),
    available: model.number().nullable(),
    sold: model.number().nullable(),
    medusa_available: model.number().nullable(),
    stock_state: model.text().nullable(),
    format: model.text().nullable(),
    category_id: model.text().nullable(),
    started_at: model.dateTime().nullable(),
    ending_at: model.dateTime().nullable(),
    ended_by: model.text().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["allegro_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["variant_id"], where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
  ])

export default AllegroOffer
