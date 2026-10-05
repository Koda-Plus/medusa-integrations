import { model } from "@medusajs/framework/utils"

/**
 * Snapshot of one BaseLinker card and its link to a Medusa variant.
 *
 * A CACHE OF WHAT BASELINKER SAYS, rebuilt by every catalog read. Only what
 * the matching, the stock plan and the admin need is stored. `variant_id`,
 * `product_id`, `variant_sku` and `product_title` are filled by the matching
 * (denormalized, so the admin lists need no joins). `conflict` explains why a
 * card is NOT linked: `duplicate_sku`, `duplicate_ean` or `ambiguous_variant`.
 *
 * `stock` is the number in the configured warehouse, null when the card has
 * none there (never read as zero). `demo` keeps simulated cards apart, and
 * the id is unique per mode, so switching to a real account starts clean.
 */
const BaseLinkerProduct = model
  .define("baselinker_product", {
    id: model.id({ prefix: "blprod" }).primaryKey(),
    bl_product_id: model.text(),
    parent_id: model.text().nullable(),
    sku: model.text().nullable(),
    ean: model.text().nullable(),
    name: model.text(),
    stock: model.number().nullable(),
    price: model.json().nullable(),
    match_key: model.text().nullable(),
    match_source: model.text().nullable(),
    variant_id: model.text().nullable(),
    product_id: model.text().nullable(),
    variant_sku: model.text().nullable(),
    product_title: model.text().nullable(),
    conflict: model.text().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["bl_product_id", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["variant_id"], where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
  ])

export default BaseLinkerProduct
