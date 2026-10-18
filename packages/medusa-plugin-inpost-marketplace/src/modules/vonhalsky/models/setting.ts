import { model } from "@medusajs/framework/utils"

/**
 * ONE SETTING the team picked in the admin: the markup, where imported
 * orders land, the shipping option of each delivery type. Keyed by name.
 */
const VonHalskySetting = model
  .define("vonhalsky_setting", {
    id: model.id({ prefix: "vhset" }).primaryKey(),
    key: model.text(),
    value: model.json().nullable(),
  })
  .indexes([{ on: ["key"], unique: true, where: "deleted_at IS NULL" }])

export default VonHalskySetting
