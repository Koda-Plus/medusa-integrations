import { model } from "@medusajs/framework/utils"

/**
 * ONE RUNG OF THE LADDER of a product: how many pieces fit into the unit
 * (a piece is 1, a box maybe 12, a pallet maybe 120), with the EAN of the
 * unit and the SSCC prefix of the pallet labels.
 */
const PackagingUnit = model
  .define("packaging_unit", {
    id: model.id({ prefix: "pku" }).primaryKey(),
    product_id: model.text(),
    name: model.text().default("szt."),
    pieces: model.number().default(1),
    ean: model.text().nullable(),
    sscc_prefix: model.text().nullable(),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["product_id", "name"], where: "deleted_at IS NULL" },
    { on: ["product_id", "pieces"], where: "deleted_at IS NULL" },
  ])

export default PackagingUnit
