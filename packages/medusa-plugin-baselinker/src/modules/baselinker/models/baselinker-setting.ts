import { model } from "@medusajs/framework/utils"

/**
 * Small state the plugin keeps between runs, one row per key and mode:
 *
 *   writer:<key>      { armed } of one writer, with who flipped it and when
 *   directions        demo mode only: the directions a visitor picked
 *   cursor:orders     where the marketplace order import continues
 *   cursor:journal    the last journal event processed
 *   demo:state        demo mode only: what the simulated writers changed
 *
 * `demo` keeps the simulation apart: arming a writer in demo mode never arms
 * it for a real account connected later.
 */
const BaseLinkerSetting = model
  .define("baselinker_setting", {
    id: model.id({ prefix: "blset" }).primaryKey(),
    key: model.text(),
    value: model.json().nullable(),
    demo: model.boolean().default(false),
    changed_by: model.text().nullable(),
    changed_by_label: model.text().nullable(),
    changed_at: model.dateTime().nullable(),
  })
  .indexes([{ on: ["key", "demo"], unique: true, where: "deleted_at IS NULL" }])

export default BaseLinkerSetting
