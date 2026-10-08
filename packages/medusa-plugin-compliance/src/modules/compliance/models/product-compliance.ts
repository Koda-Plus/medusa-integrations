import { model } from "@medusajs/framework/utils"

/**
 * THE GPSR RECORD OF ONE PRODUCT. Links the Medusa product to its
 * manufacturer and its EU responsible person, carries the warnings and
 * safety information the distance-sales offer must show, and the
 * `complete` flag the panel computes from those fields.
 */
const ComplianceProduct = model
  .define("compliance_product", {
    id: model.id({ prefix: "cpr" }).primaryKey(),
    product_id: model.text(),
    sku: model.text().nullable(),
    title: model.text().nullable(),
    manufacturer_id: model.text().nullable(),
    responsible_person_id: model.text().nullable(),
    warnings: model.json().nullable(),
    safety_info: model.text().nullable(),
    complete: model.boolean().default(false),
    demo: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["product_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["sku"], where: "deleted_at IS NULL" },
    { on: ["demo", "complete"], where: "deleted_at IS NULL" },
  ])

export default ComplianceProduct
