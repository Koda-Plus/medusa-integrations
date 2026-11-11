import { model } from "@medusajs/framework/utils"

/**
 * A MEDUSA CATEGORY MAPPED TO A CENEO CATEGORY. One row per Medusa
 * category. The mapping applies to the whole subtree of the Medusa
 * category, unless a subcategory has its own.
 */
const CeneoCategoryMap = model
  .define("ceneo_category_map", {
    id: model.id({ prefix: "ccm" }).primaryKey(),
    category_id: model.text(),
    ceneo_id: model.text(),
  })
  .indexes([{ on: ["category_id"], unique: true, where: "deleted_at IS NULL" }])

export default CeneoCategoryMap
