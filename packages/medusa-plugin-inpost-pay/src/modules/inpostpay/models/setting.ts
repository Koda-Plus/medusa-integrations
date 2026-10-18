import { model } from "@medusajs/framework/utils"

/**
 * ONE SETTING the team picked in the admin: the shipping option of each
 * InPost Pay delivery type, the places of the button. Keyed by name.
 */
const InpostPaySetting = model
  .define("inpost_pay_setting", {
    id: model.id({ prefix: "ipset" }).primaryKey(),
    key: model.text(),
    value: model.json().nullable(),
  })
  .indexes([{ on: ["key"], unique: true, where: "deleted_at IS NULL" }])

export default InpostPaySetting
