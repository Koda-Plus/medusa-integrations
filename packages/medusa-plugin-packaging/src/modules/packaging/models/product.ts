import { model } from "@medusajs/framework/utils"

/**
 * THE PACKAGING OF ONE PRODUCT: the minimum order quantity and the order
 * step in pieces. The ladder (piece, box, pallet) lives in
 * `packaging_unit` rows.
 */
const PackagingProduct = model
  .define("packaging_product", {
    id: model.id({ prefix: "ppr" }).primaryKey(),
    product_id: model.text(),
    sku: model.text().nullable(),
    title: model.text().nullable(),
    moq: model.number().default(0),
    step: model.number().default(0),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["product_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["sku"], where: "deleted_at IS NULL" },
  ])

export default PackagingProduct
