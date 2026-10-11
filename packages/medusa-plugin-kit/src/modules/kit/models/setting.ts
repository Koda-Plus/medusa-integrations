import { model } from "@medusajs/framework/utils"

/**
 * ONE SETTING the team picked in the admin: the tags for new subscribers,
 * the double opt-in form, the double opt-in switch. Keyed by name, so the
 * routes read and write single rows.
 */
const KitSetting = model.define("kit_setting", {
  id: model.id({ prefix: "kitset" }).primaryKey(),
  key: model.text(),
  /** A JSON value (an array of tag ids, a number, a boolean). */
  value: model.json().nullable(),
})
  .indexes([{ on: ["key"], unique: true, where: "deleted_at IS NULL" }])

export default KitSetting
