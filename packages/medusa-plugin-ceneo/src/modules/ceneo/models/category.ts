import { model } from "@medusajs/framework/utils"

/**
 * ONE CATEGORY OF THE CENEO TREE (developers.ceneo.pl/api/v3/kategorie),
 * refreshed once a day. `path` is computed here ("Parent/Child"): Ceneo
 * gives the tree, not the paths. A category gone from the tree stays with
 * `active` false, so a mapping that points at it says so instead of
 * silently losing its category.
 */
const CeneoCategory = model
  .define("ceneo_category", {
    id: model.id({ prefix: "cct" }).primaryKey(),
    ceneo_id: model.text(),
    name: model.text(),
    parent_ceneo_id: model.text().nullable(),
    path: model.text(),
    depth: model.number().default(0),
    leaf: model.boolean().default(true),
    active: model.boolean().default(true),
    synced_at: model.dateTime(),
  })
  .indexes([
    { on: ["ceneo_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["active"], where: "deleted_at IS NULL" },
  ])

export default CeneoCategory
